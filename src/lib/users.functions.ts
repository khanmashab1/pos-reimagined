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

function getClient(token: string) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://ivczucpqxwwthhyzphix.supabase.co";
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Y3p1Y3BxeHd3dGhoeXpwaGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyOTgzODksImV4cCI6MjEwMjg3NDM4OX0.rNpBnN2xppIFblYjl0bkkmLvQXLEkFVAejzEVSWlDqM";
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const createUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createUserSchema.parse(data))
  .handler(async ({ data }) => {
    const client = getClient(data.token);
    const { data: newUserId, error } = await client.rpc("admin_create_user" as any, {
      _email: data.email.trim().toLowerCase(),
      _password: data.password,
      _full_name: data.full_name.trim(),
      _username: data.username.trim(),
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { id: newUserId, email: data.email, role: data.role };
  });

export const updateUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => updateUserSchema.parse(data))
  .handler(async ({ data }) => {
    const client = getClient(data.token);
    const { error } = await client.rpc("admin_update_user" as any, {
      _target_user_id: data.user_id,
      _full_name: data.full_name.trim(),
      _username: data.username.trim(),
      _password: data.password ? data.password.trim() : null,
    });
    if (error) throw new Error(error.message);
    return { id: data.user_id };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => deleteUserSchema.parse(data))
  .handler(async ({ data }) => {
    const client = getClient(data.token);
    const { error } = await client.rpc("admin_delete_user" as any, {
      _target_user_id: data.user_id,
    });
    if (error) throw new Error(error.message);
    return { id: data.user_id };
  });
