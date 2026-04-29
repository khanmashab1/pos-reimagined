import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2, Store } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, user, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (role === "admin") navigate({ to: "/admin/dashboard" });
    else navigate({ to: "/pos" });
  }, [loading, user, role, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: "var(--gradient-primary)" }}>
          <Store className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold">ZIC Mart POS</h1>
        <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}
