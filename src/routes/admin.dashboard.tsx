import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import { ShoppingCart, TrendingUp, Package, AlertTriangle, ArrowRight } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/admin/dashboard")({
  component: Dashboard,
});

const PIE_COLORS = ["hsl(142 71% 45%)", "hsl(210 90% 56%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)"];

function Dashboard() {
  const [stats, setStats] = useState({ todaySales: 0, todayBills: 0, products: 0, lowStock: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [daily, setDaily] = useState<{ day: string; sales: number; bills: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([]);
  const [margin, setMargin] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    (async () => {
      const dayStart = new Date(); dayStart.setHours(0,0,0,0);
      const last30 = new Date(); last30.setDate(last30.getDate() - 29); last30.setHours(0,0,0,0);

      const [{ data: todaySales }, { data: prods }, { data: monthSales }, { data: monthItems }] = await Promise.all([
        supabase.from("sales").select("id,total,bill_no,cashier_name,items_count,created_at").gte("created_at", dayStart.toISOString()).order("created_at", { ascending: false }),
        supabase.from("products").select("id,name,stock,min_stock_alert,sale_price"),
        supabase.from("sales").select("id,total,created_at").gte("created_at", last30.toISOString()),
        supabase.from("sale_items").select("product_name,qty,unit_price,purchase_price,subtotal,sales!inner(created_at)").gte("sales.created_at", last30.toISOString()),
      ]);

      const allSales = todaySales ?? [];
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

      // Daily trend (last 14 days)
      const days: Record<string, { sales: number; bills: number }> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0);
        const k = d.toISOString().slice(0, 10);
        days[k] = { sales: 0, bills: 0 };
      }
      (monthSales ?? []).forEach(s => {
        const k = new Date(s.created_at).toISOString().slice(0, 10);
        if (days[k]) { days[k].sales += Number(s.total); days[k].bills += 1; }
      });
      setDaily(Object.entries(days).map(([day, v]) => ({
        day: day.slice(5),
        sales: Math.round(v.sales),
        bills: v.bills,
      })));

      // Top products (last 30 days)
      const agg: Record<string, { qty: number; revenue: number }> = {};
      let lowM = 0, midM = 0, highM = 0;
      (monthItems ?? []).forEach((it: any) => {
        const a = (agg[it.product_name] ??= { qty: 0, revenue: 0 });
        a.qty += Number(it.qty);
        a.revenue += Number(it.subtotal);
        const cost = Number(it.purchase_price) * Number(it.qty);
        const rev = Number(it.subtotal);
        if (rev > 0) {
          const m = ((rev - cost) / rev) * 100;
          if (m < 10) lowM += rev;
          else if (m < 30) midM += rev;
          else highM += rev;
        }
      });
      setTopProducts(
        Object.entries(agg)
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.qty - a.qty)
          .slice(0, 7)
      );
      setMargin([
        { name: "Low (<10%)", value: Math.round(lowM) },
        { name: "Mid (10-30%)", value: Math.round(midM) },
        { name: "High (>30%)", value: Math.round(highM) },
      ].filter(x => x.value > 0));
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

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Sales Trend (Last 14 Days)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Area type="monotone" dataKey="sales" stroke="hsl(142 71% 45%)" fill="url(#salesGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Top Selling Products (30d)</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No sales data yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="qty" fill="hsl(210 90% 56%)" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-4">Margin Distribution (Revenue)</h3>
          {margin.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No margin data yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={margin} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.name}>
                    {margin.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => fmt(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Sales (Today)</h3>
            <Link to="/admin/reports" className="text-xs text-primary flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
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
