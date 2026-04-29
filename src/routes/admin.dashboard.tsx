import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import { ShoppingCart, TrendingUp, Package, AlertTriangle, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [stats, setStats] = useState({ todaySales: 0, todayBills: 0, products: 0, lowStock: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const dayStart = new Date(); dayStart.setHours(0,0,0,0);
      const [{ data: sales }, { data: prods }] = await Promise.all([
        supabase.from("sales").select("id,total,bill_no,cashier_name,items_count,created_at").gte("created_at", dayStart.toISOString()).order("created_at", { ascending: false }),
        supabase.from("products").select("id,name,stock,min_stock_alert,sale_price"),
      ]);
      const allSales = sales ?? [];
      const allProds = prods ?? [];
      const low = allProds.filter(p => p.stock <= p.min_stock_alert);
      setStats({
        todaySales: allSales.reduce((s, x) => s + Number(x.total), 0),
        todayBills: allSales.length,
        products: allProds.length,
        lowStock: low.length,
      });
      setRecent(allSales.slice(0, 6));
      setLowStock(low.slice(0, 6));
    })();
  }, []);

  const cards = [
    { label: "Today's Sales", value: fmt(stats.todaySales), icon: TrendingUp, color: "var(--success)" },
    { label: "Today's Bills", value: stats.todayBills, icon: ShoppingCart, color: "var(--info)" },
    { label: "Total Products", value: stats.products, icon: Package, color: "var(--accent)" },
    { label: "Low Stock", value: stats.lowStock, icon: AlertTriangle, color: "var(--warning)" },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back to ZIC Mart POS</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <Card key={c.label} className="p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{c.label}</div>
                <div className="mt-2 text-2xl font-bold">{c.value}</div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: c.color, opacity: 0.15 }}>
                <c.icon className="h-5 w-5" style={{ color: c.color }} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Sales (Today)</h3>
            <Link to="/admin/products" className="text-xs text-primary flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No sales yet today.</p>
          ) : (
            <div className="space-y-2">
              {recent.map(s => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="font-mono text-sm">{s.bill_no}</div>
                    <div className="text-xs text-muted-foreground">{s.cashier_name} · {s.items_count} items</div>
                  </div>
                  <div className="font-semibold">{fmt(s.total)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Low Stock Alerts</h3>
            <Link to="/admin/products" className="text-xs text-primary flex items-center gap-1">Manage <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">All products are well-stocked. ✓</p>
          ) : (
            <div className="space-y-2">
              {lowStock.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Min: {p.min_stock_alert}</div>
                  </div>
                  <div className={`text-sm font-semibold ${p.stock === 0 ? "text-destructive" : "text-warning"}`}>
                    {p.stock} left
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
