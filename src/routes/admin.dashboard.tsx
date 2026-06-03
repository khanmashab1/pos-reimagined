import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  ShoppingCart, TrendingUp, Package, AlertTriangle, ArrowRight,
  RotateCcw, Wallet, Percent, ArrowUpRight, ArrowDownRight, Users, Clock,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/admin/dashboard")({
  component: Dashboard,
});

const PIE_COLORS = ["hsl(142 71% 45%)", "hsl(210 90% 56%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)"];
const PAY_COLORS = ["hsl(142 71% 45%)", "hsl(210 90% 56%)"]; // cash = green, online = blue

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

/** Abbreviate large numbers for chart axes (45k, 1.2M). */
function abbrev(n: number) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(v));
}

function hourLabel(h: number) {
  const n = Number(h);
  const ampm = n < 12 ? "a" : "p";
  const hr = n % 12 === 0 ? 12 : n % 12;
  return `${hr}${ampm}`;
}

/** ▲/▼ percent change vs the previous equal period. `invert` => up is bad (refunds). */
function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  if (!prev || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (!isFinite(pct) || Math.abs(pct) < 0.05) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${good ? "text-green-600" : "text-destructive"}`}>
      <Icon className="h-3 w-3" />{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function StatCard({ label, value, icon: Icon, color, delta, big, loading }: {
  label: string; value: ReactNode; icon: ComponentType<{ className?: string; style?: any }>;
  color: string; delta?: ReactNode; big?: boolean; loading?: boolean;
}) {
  return (
    <Card className={`p-4 shadow-[var(--shadow-card)] ${big ? "border-l-4" : ""}`}
      style={big ? { borderLeftColor: color } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
          {loading ? (
            <Skeleton className="mt-2 h-6 w-24" />
          ) : (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className={`font-bold break-words leading-tight ${big ? "text-2xl sm:text-3xl" : "text-base sm:text-xl"}`}>
                {value}
              </span>
              {delta}
            </div>
          )}
        </div>
        <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg">
          <div className="absolute inset-0 rounded-lg opacity-15" style={{ background: color }} />
          <Icon className="relative h-4 w-4 sm:h-5 sm:w-5" style={{ color }} />
        </div>
      </div>
    </Card>
  );
}

function ChartCard({ title, icon: Icon, empty, loading, children }: {
  title: string; icon?: ComponentType<{ className?: string }>; empty?: boolean;
  loading?: boolean; children: ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />} {title}
      </h3>
      {loading ? (
        <Skeleton className="h-56 sm:h-64 w-full" />
      ) : empty ? (
        <p className="text-sm text-muted-foreground py-12 text-center">No data yet.</p>
      ) : (
        <div className="h-56 sm:h-64">{children}</div>
      )}
    </Card>
  );
}

function Dashboard() {
  const isMobile = useIsMobile();
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [stats, setStats] = useState({ products: 0, lowStock: 0 });
  const [kpis, setKpis] = useState({
    grossSales: 0, bills: 0, refunds: 0, net: 0, rate: 0, returnsCount: 0,
    cashSales: 0, onlineSales: 0, grossProfit: 0,
  });
  const [prev, setPrev] = useState({ grossSales: 0, bills: 0, net: 0, grossProfit: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [daily, setDaily] = useState<{ day: string; sales: number; refunds: number }[]>([]);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number; revenue: number }[]>([]);
  const [margin, setMargin] = useState<{ name: string; value: number }[]>([]);
  const [topCashiers, setTopCashiers] = useState<{ name: string; sales: number; bills: number }[]>([]);
  const [hourly, setHourly] = useState<{ hour: number; sales: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
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

        if (!active) return;

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
          cashSales: Number(s.cashSales ?? 0),
          onlineSales: Number(s.onlineSales ?? 0),
          grossProfit: Number(s.grossProfit ?? 0),
        });
        setPrev({
          grossSales: Number(s.prev?.grossSales ?? 0),
          bills: Number(s.prev?.bills ?? 0),
          net: Number(s.prev?.net ?? 0),
          grossProfit: Number(s.prev?.grossProfit ?? 0),
        });
        setRecent(recentSales ?? []);
        setLowStock(((i.lowStockItems ?? []) as any[]).slice(0, 6));
        setDaily((s.daily ?? []) as any[]);
        setTopProducts((s.topProducts ?? []) as any[]);
        setMargin((s.margin ?? []) as any[]);
        setTopCashiers((s.topCashiers ?? []) as any[]);
        setHourly((s.hourly ?? []) as any[]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [period]);

  const avgBill = kpis.bills > 0 ? kpis.grossSales / kpis.bills : 0;
  const payMix = [
    { name: "Cash", value: kpis.cashSales },
    { name: "Online", value: kpis.onlineSales },
  ];
  const payTotal = kpis.cashSales + kpis.onlineSales;

  return (
    <div className="p-4 pt-16 md:p-8 md:pt-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="pl-12 md:pl-0">
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Welcome back to ZIC Mart POS</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {PERIODS.map(p => (
            <Button key={p.key} variant={period === p.key ? "default" : "outline"} size="sm"
              onClick={() => setPeriod(p.key)}>{p.label}</Button>
          ))}
        </div>
      </div>

      {/* Hero band */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard big label="Net Sales" value={fmt(kpis.net)} icon={Wallet} color="var(--success)"
          delta={<Delta cur={kpis.net} prev={prev.net} />} loading={loading} />
        <StatCard label="Gross Sales" value={fmt(kpis.grossSales)} icon={TrendingUp} color="var(--info)"
          delta={<Delta cur={kpis.grossSales} prev={prev.grossSales} />} loading={loading} />
        <StatCard label="Gross Profit" value={fmt(kpis.grossProfit)} icon={Percent} color="var(--accent)"
          delta={<Delta cur={kpis.grossProfit} prev={prev.grossProfit} />} loading={loading} />
        <StatCard label="Avg Bill" value={fmt(avgBill)} icon={ShoppingCart} color="var(--info)" loading={loading} />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Bills" value={kpis.bills} icon={ShoppingCart} color="var(--info)"
          delta={<Delta cur={kpis.bills} prev={prev.bills} />} loading={loading} />
        <StatCard label="Refunds (Approved)" value={fmt(kpis.refunds)} icon={RotateCcw} color="var(--warning)" loading={loading} />
        <StatCard label="Return Rate" value={kpis.rate.toFixed(2) + "%"} icon={Percent} color="var(--destructive)" loading={loading} />
        <StatCard label="Total Products" value={stats.products} icon={Package} color="var(--info)" loading={loading} />
        <StatCard label="Low Stock" value={stats.lowStock} icon={AlertTriangle} color="var(--warning)" loading={loading} />
      </div>

      {/* Cash vs Online + Sales vs Refunds */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Cash vs Online" icon={Wallet} loading={loading} empty={payTotal === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={payMix} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={isMobile ? 45 : 58} outerRadius={isMobile ? 70 : 88} paddingAngle={2}>
                {payMix.map((_, i) => <Cell key={i} fill={PAY_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sales vs Refunds" icon={TrendingUp} loading={loading} empty={daily.length === 0}>
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
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={abbrev} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Legend />
              <Area type="monotone" dataKey="sales" stroke="hsl(142 71% 45%)" fill="url(#salesGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="refunds" stroke="hsl(0 84% 60%)" fill="url(#refundGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Peak hours + Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Peak Sales Hours" icon={Clock} loading={loading}
          empty={hourly.every(h => Number(h.sales) === 0)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="hour" tickFormatter={(h) => hourLabel(Number(h))}
                tick={{ fontSize: 10 }} interval={isMobile ? 3 : 1} />
              <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={abbrev} />
              <Tooltip formatter={(v: any) => fmt(Number(v))} labelFormatter={(h) => hourLabel(Number(h))} />
              <Bar dataKey="sales" fill="hsl(210 90% 56%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top Selling Products" icon={Package} loading={loading} empty={topProducts.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topProducts} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={abbrev} />
              <YAxis dataKey="name" type="category" width={isMobile ? 80 : 110} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="qty" fill="hsl(210 90% 56%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Top cashiers + Margin distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> Top Cashiers</h3>
            <Link to="/admin/cashier-report" className="text-xs text-primary flex items-center gap-1">Report <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : topCashiers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No cashier sales yet.</p>
          ) : (
            <div className="space-y-1">
              {topCashiers.map((c, i) => (
                <div key={c.name + i} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold shrink-0">{i + 1}</div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.bills} bills</div>
                    </div>
                  </div>
                  <div className="font-semibold text-sm shrink-0">{fmt(c.sales)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <ChartCard title="Margin Distribution (Revenue)" icon={Percent} loading={loading} empty={margin.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={margin} dataKey="value" nameKey="name" cx="50%" cy="50%"
                outerRadius={isMobile ? 70 : 80} label={isMobile ? false : (e: any) => e.name}>
                {margin.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Recent sales + Low stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Sales</h3>
            <Link to="/admin/reports" className="text-xs text-primary flex items-center gap-1">View all <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No sales in this period.</p>
          ) : (
            <div className="space-y-2">
              {recent.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <div className="font-mono text-sm truncate">{s.bill_no}</div>
                    <div className="text-xs text-muted-foreground truncate">{s.cashier_name} · {s.items_count} items</div>
                  </div>
                  <div className="font-semibold shrink-0">{fmt(s.total)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Low Stock Alerts</h3>
            <Link to="/admin/products" className="text-xs text-primary flex items-center gap-1">Manage <ArrowRight className="h-3 w-3" /></Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">All products are well-stocked. ✓</p>
          ) : (
            <div className="space-y-2">
              {lowStock.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">Min: {p.min_stock_alert}</div>
                  </div>
                  <div className={`text-sm font-semibold shrink-0 ${p.stock === 0 ? "text-destructive" : "text-warning"}`}>
                    {p.stock} left
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-4 sm:p-5 bg-muted/40">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold flex items-center gap-2"><Package className="h-5 w-5" /> Stock Management</h3>
            <p className="text-xs text-muted-foreground mt-1">View stock entries from cashiers</p>
          </div>
          <Link to="/admin/stock-summary" className="text-primary hover:underline text-sm font-medium shrink-0">View →</Link>
        </div>
      </Card>
    </div>
  );
}
