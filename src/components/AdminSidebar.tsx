import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard, Package, Tag, Settings as SettingsIcon, ShoppingCart,
  LogOut, Store, RotateCcw, FileBarChart, Users, Menu, X, ClipboardList,
  Truck, TrendingUp, AlertTriangle, Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const items = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products", icon: Package },
  { to: "/admin/categories", label: "Categories", icon: Tag },
  { to: "/admin/suppliers", label: "Suppliers", icon: Truck },
  { to: "/admin/low-stock", label: "Low Stock", icon: AlertTriangle, alert: true },
  { to: "/admin/returns", label: "Returns", icon: RotateCcw },
  { to: "/admin/profit-calculator", label: "Profit Calculator", icon: TrendingUp },
  { to: "/admin/reports", label: "Sales Reports", icon: FileBarChart },
  { to: "/admin/shifts", label: "Cashier Shifts", icon: ClipboardList },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/backup", label: "Backup", icon: Database },
  { to: "/admin/settings", label: "Settings", icon: SettingsIcon },
];

function useLowStockCount() {
  const [count, setCount] = useState<{ out: number; low: number }>({ out: 0, low: 0 });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const { data } = await supabase
        .from("products")
        .select("stock,min_stock_alert")
        .eq("is_active", true);
      if (cancelled || !data) return;
      let out = 0, low = 0;
      for (const r of data as any[]) {
        const s = Number(r.stock);
        const t = Number(r.min_stock_alert ?? 5);
        if (s <= t) {
          if (s === 0) out++;
          else low++;
        }
      }
      setCount({ out, low });
    };
    refresh();
    // refresh every 60s while sidebar is mounted
    const id = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return count;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { fullName, signOut } = useAuth();
  const path = useRouterState({ select: s => s.location.pathname });
  const { out, low } = useLowStockCount();
  const totalAlerts = out + low;

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
          const showAlert = it.alert && totalAlerts > 0;
          // Red badge if any product is fully out, otherwise orange for low
          const badgeClass = out > 0
            ? "bg-destructive text-destructive-foreground"
            : "bg-warning text-warning-foreground";
          return (
            <Link key={it.to} to={it.to} onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "hover:bg-sidebar-accent"
              }`}>
              <it.icon className="h-4 w-4" />
              <span className="flex-1">{it.label}</span>
              {showAlert && (
                <Badge className={`${badgeClass} h-5 min-w-[1.25rem] px-1.5 text-xs`}>
                  {totalAlerts}
                </Badge>
              )}
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
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Button size="icon" variant="outline" className="h-10 w-10 bg-background shadow-md" onClick={() => setMobileOpen(true)}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>

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

      <aside className="hidden md:flex w-60 flex-col bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>
    </>
  );
}
