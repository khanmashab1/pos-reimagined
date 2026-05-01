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

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Missing Supabase environment variables");
    }

    // Create a Supabase client authenticated as the calling user
    const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${data.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify caller is admin
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

    // Create the auth user (auto-confirmed so they can sign in immediately)
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

    // The handle_new_user trigger creates a profile + default role.
    // Force the requested role.
    const { error: roleUpdateErr } = await supabaseAdmin
      .from("user_roles")
      .update({ role: data.role })
      .eq("user_id", newUserId);

    if (roleUpdateErr) {
      await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: data.role });
    }

    // Audit log
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
