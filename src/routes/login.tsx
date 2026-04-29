import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Store, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: role === "admin" ? "/admin/dashboard" : "/pos" });
    }
  }, [user, role, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: "var(--gradient-primary)" }}>
      <Card className="w-full max-w-md p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Store className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">ZIC Mart POS</h1>
          <p className="mt-1 text-sm text-muted-foreground">Murree Road, Abbottabad</p>
        </div>
        <SignInForm />
      </Card>
    </div>
  );
}

function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Welcome back!");
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-4">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="pwd">Password</Label>
        <Input id="pwd" type="password" required value={password} onChange={e => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign In
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        New users can be added by an admin from the Users panel.
      </p>
    </form>
  );
}
