import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type Role = "admin" | "cashier" | null;

interface AuthCtx {
  user: User | null;
  session: Session | null;
  role: Role;
  fullName: string;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, session: null, role: null, fullName: "", loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) {
        setTimeout(() => loadProfile(sess.user.id), 0);
      } else {
        setRole(null);
        setFullName("");
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(uid: string) {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle(),
      supabase.from("profiles").select("full_name, username, is_active").eq("id", uid).maybeSingle(),
    ]);
    if (p && (p as any).is_active === false) {
      await supabase.auth.signOut();
      setRole(null); setFullName(""); setUser(null); setSession(null);
      setLoading(false);
      if (typeof window !== "undefined") window.location.href = "/login?disabled=1";
      return;
    }
    setRole((r?.role as Role) ?? "cashier");
    setFullName(p?.full_name || p?.username || "User");
    setLoading(false);
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return <Ctx.Provider value={{ user, session, role, fullName, loading, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
