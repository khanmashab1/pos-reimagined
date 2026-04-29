import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { LayoutDashboard, Package, Tag, Settings as SettingsIcon, ShoppingCart, LogOut, Store } from "lucide-react";
import { Button } from "@/components/ui/button";

const items = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/categories", label: "Categories", icon: Tag },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

export function AdminSidebar() {
  const { fullName, signOut } = useAuth();
  const path = useRouterState({ select: s => s.location.pathname });

  return (
    <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <div className="font-bold text-sm">ZIC Mart</div>
          <div className="text-xs opacity-70">POS Admin</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {items.map(it => {
          const active = path.startsWith(it.to);
          return (
            <Link key={it.to} to={it.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
              }`}>
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
        <Link to="/pos"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors hover:bg-sidebar-accent">
          <ShoppingCart className="h-4 w-4" />
          Open POS
        </Link>
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="px-3 py-2 text-xs opacity-70">Signed in as</div>
        <div className="px-3 pb-2 text-sm font-medium truncate">{fullName}</div>
        <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sign out
        </Button>
      </div>
    </aside>
  );
}
