import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
  full_name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  role: z.enum(["admin", "cashier"]),
  token: z.string().min(1),
});

const updateUserSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  password: z.string().max(128).optional(),
  token: z.string().min(1),
});

const deleteUserSchema = z.object({
  user_id: z.string().uuid(),
  token: z.string().min(1),
});

/** Verify the bearer token belongs to an active admin; returns their id + display name. */
async function requireAdmin(token: string) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing Supabase environment variables");
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimsErr } = await userClient.auth.getUser();
  if (claimsErr || !claims?.user) throw new Error("Unauthorized");
  const { data: roleRow, error: roleErr } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", claims.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (roleErr) throw new Error(roleErr.message);
  if (!roleRow) throw new Error("Only admins can manage users");
  return {
    userId: claims.user.id,
    callerName: (claims.user.user_metadata?.full_name as string) ?? "Admin",
  };
}

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Missing Supabase environment variables");
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${data.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: claims, error: claimsErr } = await userClient.auth.getUser();
    if (claimsErr || !claims?.user) throw new Error("Unauthorized");

    const userId = claims.user.id;

    const { data: roleRow, error: roleErr } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Only admins can create users");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        username: data.username,
      },
    });

    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "Failed to create user");
    }

    const newUserId = created.user.id;

    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", newUserId)
      .maybeSingle();

    if (!existingProfile) {
      await supabaseAdmin.from("profiles").insert({
        id: newUserId,
        full_name: data.full_name,
        username: data.username,
        is_active: true,
      });
    }

    const { error: roleUpdateErr } = await supabaseAdmin
      .from("user_roles")
      .update({ role: data.role })
      .eq("user_id", newUserId);

    if (roleUpdateErr) {
      await supabaseAdmin.from("user_roles").upsert(
        { user_id: newUserId, role: data.role },
        { onConflict: "user_id" }
      );
    }

    const callerName = claims.user.user_metadata?.full_name ?? "Admin";
    await supabaseAdmin.from("user_audit_log").insert({
      actor_id: userId,
      actor_name: callerName,
      target_user_id: newUserId,
      target_user_name: data.full_name,
      action: "user_created",
      details: { email: data.email, role: data.role },
    });

    return { id: newUserId, email: data.email, role: data.role };
  });

export const updateUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateUserSchema.parse(data))
  .handler(async ({ data }) => {
    const { userId, callerName } = await requireAdmin(data.token);

    // Profile fields (name / username)
    const { error: profErr } = await supabaseAdmin
      .from("profiles")
      .update({ full_name: data.full_name, username: data.username })
      .eq("id", data.user_id);
    if (profErr) throw new Error(profErr.message);

    // Auth metadata + optional password reset
    const authUpdate: { user_metadata: Record<string, unknown>; password?: string } = {
      user_metadata: { full_name: data.full_name, username: data.username },
    };
    if (data.password && data.password.length >= 6) authUpdate.password = data.password;
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, authUpdate);
    if (authErr) throw new Error(authErr.message);

    await supabaseAdmin.from("user_audit_log").insert({
      actor_id: userId,
      actor_name: callerName,
      target_user_id: data.user_id,
      target_user_name: data.full_name,
      action: "user_updated",
      details: { password_reset: !!authUpdate.password },
    });

    return { id: data.user_id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => deleteUserSchema.parse(data))
  .handler(async ({ data }) => {
    const { userId, callerName } = await requireAdmin(data.token);
    if (data.user_id === userId) throw new Error("You cannot delete yourself");

    // Capture name for the audit entry before deletion
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", data.user_id)
      .maybeSingle();
    const targetName = (prof?.full_name as string) || (prof?.username as string) || "";

    const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (delErr) throw new Error(delErr.message);

    // Clean up app rows (in case FK cascade is not configured)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("profiles").delete().eq("id", data.user_id);

    await supabaseAdmin.from("user_audit_log").insert({
      actor_id: userId,
      actor_name: callerName,
      target_user_id: data.user_id,
      target_user_name: targetName,
      action: "user_deleted",
      details: {},
    });

    return { id: data.user_id };
  });
