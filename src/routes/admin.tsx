import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { loading, user, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
    else if (role !== "admin") navigate({ to: "/pos" });
  }, [loading, user, role, navigate]);

  if (loading || !user || role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AdminSidebar />
      <main className="flex-1 overflow-auto"><Outlet /></main>
    </div>
  );
}
