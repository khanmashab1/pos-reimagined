import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { LayoutDashboard, Package, Tag, Settings as SettingsIcon, ShoppingCart, LogOut, Store, RotateCcw, FileBarChart, Users, Menu, X, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const items = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/categories", label: "Categories", icon: Tag },
  { to: "/admin/returns", label: "Returns", icon: RotateCcw },
  { to: "/admin/reports", label: "Sales Reports", icon: FileBarChart },
  { to: "/admin/shifts", label: "Cashier Shifts", icon: ClipboardList },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { fullName, signOut } = useAuth();
  const path = useRouterState({ select: s => s.location.pathname });

  return (
    <>
      <div className="flex items-center gap-2 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <div className="font-bold text-sm">ZIC Mart</div>
          <div className="text-xs opacity-70">POS Admin</div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {items.map(it => {
          const active = path.startsWith(it.to);
          return (
            <Link key={it.to} to={it.to} onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
              }`}>
              <it.icon className="h-4 w-4" />
              {it.label}
            </Link>
          );
        })}
        <Link to="/pos" onClick={onNavigate}
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
    </>
  );
}

export function AdminSidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger button */}
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Button size="icon" variant="outline" className="h-10 w-10 bg-background shadow-md" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 flex flex-col bg-sidebar text-sidebar-foreground h-full z-10">
            <Button size="icon" variant="ghost" className="absolute top-3 right-3 text-sidebar-foreground" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>
    </>
  );
}
