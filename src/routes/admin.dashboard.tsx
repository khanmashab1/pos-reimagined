import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt } from "@/lib/format";
import {
  ShoppingCart, TrendingUp, Package, AlertTriangle, ArrowRight,
  RotateCcw, Wallet, Percent,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/admin/dashboard")({
  component: Dashboard,
});

const PIE_COLORS = ["hsl(142 71% 45%)", "hsl(210 90% 56%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)"];

const PERIODS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
] as const;
type PeriodKey = typeof PERIODS[number]["key"];

function startOfPeriod(p: PeriodKey) {
  const d = new Date();
  if (p === "today") { d.setHours(0,0,0,0); return d; }
  const days = PERIODS.find(x => x.key === p)!.days;
  d.setDate(d.getDate() - (days - 1));
  d.setHours(0,0,0,0);
  return d;
}

function Dashboard() {
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [stats, setStats] = useState({ products: 0, lowStock: 0 });
  const [kpis, setKpis] = useState({ grossSales: 0, bills: 0, refunds: 0, net: 0, rate: 0, returnsCount: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [daily, setDaily] = useState<{ day: string; sales: number; refunds: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([]);
  const [margin, setMargin] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const startIso = startOfPeriod(period).toISOString();
      const days = period === "today" ? 1 : PERIODS.find(p => p.key === period)!.days;

      const [
        { data: summary },
        { data: inventory },
        { data: recentSales },
      ] = await Promise.all([
        supabase.rpc("get_admin_dashboard_summary" as any, { _start_at: startIso, _days: days }),
        supabase.rpc("get_admin_inventory_summary" as any),
        supabase.from("sales").select("id,total,bill_no,cashier_name,items_count,created_at")
          .gte("created_at", startIso).order("created_at", { ascending: false }).limit(6),
      ]);

      const s = (summary as any) ?? {};
      const i = (inventory as any) ?? {};
      setStats({ products: Number(i.products ?? 0), lowStock: Number(i.lowStock ?? 0) });
      setKpis({
        grossSales: Number(s.grossSales ?? 0),
        bills: Number(s.bills ?? 0),
        refunds: Number(s.refunds ?? 0),
        net: Number(s.net ?? 0),
        rate: Number(s.rate ?? 0),
        returnsCount: Number(s.returnsCount ?? 0),
      });
      setRecent(recentSales ?? []);
      setLowStock(((i.lowStockItems ?? []) as any[]).slice(0, 6));
      setDaily((s.daily ?? []) as any[]);
      setTopProducts((s.topProducts ?? []) as any[]);
      setMargin((s.margin ?? []) as any[]);
      setLoading(false);
    })();
  }, [period]);

  const cards = [
    { label: `${PERIODS.find(p => p.key === period)!.label} Sales`, value: fmt(kpis.grossSales), icon: TrendingUp, color: "var(--success)" },
    { label: "Bills", value: kpis.bills, icon: ShoppingCart, color: "var(--info)" },
    { label: "Refunds (Approved)", value: fmt(kpis.refunds), icon: RotateCcw, color: "var(--warning)" },
    { label: "Net Sales", value: fmt(kpis.net), icon: Wallet, color: "var(--accent)" },
    { label: "Return Rate", value: kpis.rate.toFixed(2) + "%", icon: Percent, color: "var(--destructive)" },
    { label: "Total Products", value: stats.products, icon: Package, color: "var(--info)" },
    { label: "Low Stock", value: stats.lowStock, icon: AlertTriangle, color: "var(--warning)" },
  ];

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back to ZIC Mart POS</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PERIODS.map(p => (
            <Button key={p.key} variant={period === p.key ? "default" : "outline"} size="sm"
              onClick={() => setPeriod(p.key)}>{p.label}</Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
        {cards.map(c => (
          <Card key={c.label} className="p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">{c.label}</div>
                <div className="mt-1 text-lg font-bold truncate">{c.value}</div>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: c.color, opacity: 0.15 }}>
                <c.icon className="h-4 w-4" style={{ color: c.color }} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Sales vs Refunds</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.4}/>
                  <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="refundGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.35}/>
                  <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Legend />
              <Area type="monotone" dataKey="sales" stroke="hsl(142 71% 45%)" fill="url(#salesGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="refunds" stroke="hsl(0 84% 60%)" fill="url(#refundGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Top Selling Products</h3>
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
            <h3 className="font-semibold">Recent Sales</h3>
            <Link to="/admin/reports" className="text-xs text-primary flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No sales in this period.</p>
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
