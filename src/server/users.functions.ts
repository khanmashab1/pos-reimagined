import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
  full_name: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50),
  role: z.enum(["admin", "cashier"]),
});

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;

    // Verify caller is admin
    const { data: roleRow, error: roleErr } = await supabase
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
      // Fallback: insert if no row exists
      await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: data.role });
    }

    // Audit log
    await supabaseAdmin.from("user_audit_log").insert({
      actor_id: userId,
      actor_name: (context.claims as any)?.user_metadata?.full_name ?? "Admin",
      target_user_id: newUserId,
      target_user_name: data.full_name,
      action: "user_created",
      details: { email: data.email, role: data.role },
    });

    return { id: newUserId, email: data.email, role: data.role };
  });
