import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode, type ComponentType } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
const METHOD_LABEL: Record<string, string> = { cash: "Cash", easypaisa: "EasyPaisa", jazzcash: "JazzCash", card: "Card", bank: "Bank" };
const methodLabel = (m: string) => METHOD_LABEL[(m || "").toLowerCase()] ?? m;

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
  const [period, setPeriod] = useState<PeriodKey | "custom">("7d");
  const [customFrom, setCustomFrom] = useState<string>(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [stats, setStats] = useState({ products: 0, lowStock: 0 });
  const [inventoryValue, setInventoryValue] = useState(0);
  const [inventoryProfit, setInventoryProfit] = useState(0);
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
  const [byPerson, setByPerson] = useState<Record<string, { total: number; byMethod: Record<string, number> }>>({});
  const [extras, setExtras] = useState({ discounts: 0, stockPurchased: 0, operatingExpenses: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        let startAt: Date;
        let endAt: Date;
        let days: number;
        if (period === "custom") {
          startAt = new Date(customFrom + "T00:00:00");
          endAt = new Date(customTo + "T23:59:59.999");
          if (isNaN(startAt.getTime()) || isNaN(endAt.getTime()) || endAt < startAt) {
            setLoading(false); return;
          }
          days = Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 86400000) + 1);
        } else {
          startAt = startOfPeriod(period);
          endAt = new Date();
          days = period === "today" ? 1 : PERIODS.find(p => p.key === period)!.days;
        }
        const startIso = startAt.toISOString();
        const endIso = endAt.toISOString();
        const startDate = startAt.toISOString().slice(0, 10);
        const endDate = endAt.toISOString().slice(0, 10);
        const [
          { data: summary },
          { data: inventory },
          { data: recentSales },
          { data: personPay },
          { data: extrasRaw },
        ] = await Promise.all([
          supabase.rpc("get_admin_dashboard_summary" as any, { _start_at: startIso, _days: days, _end_at: endIso }),
          supabase.rpc("get_admin_inventory_summary" as any),
          supabase.from("sales").select("id,total,bill_no,cashier_name,items_count,created_at")
            .gte("created_at", startIso).lte("created_at", endIso).order("created_at", { ascending: false }).limit(6),
          supabase.from("person_payments" as any).select("person_name,amount,payment_method")
            .gte("payment_date", startDate).lte("payment_date", endDate),
          supabase.rpc("get_period_extras" as any, { _from: startIso, _to: endIso }),
        ]) as any;

        if (!active) return;

        const s = (summary as any) ?? {};
        const i = (inventory as any) ?? {};
        setStats({ products: Number(i.products ?? 0), lowStock: Number(i.lowStock ?? 0) });

        // Total inventory value = sum(stock * purchase_price); expected profit = sum(stock * (sale_price - purchase_price))
        let invTotal = 0;
        let profitTotal = 0;
        const pageSize = 1000;
        for (let from = 0; ; from += pageSize) {
          const { data: rows, error } = await supabase
            .from("products")
            .select("stock,purchase_price,sale_price")
            .eq("is_active", true)
            .range(from, from + pageSize - 1);
          if (error || !rows || rows.length === 0) break;
          for (const r of rows as any[]) {
            const stock = Number(r.stock) || 0;
            const cost = Number(r.purchase_price) || 0;
            const sale = Number(r.sale_price) || 0;
            invTotal += stock * cost;
            profitTotal += stock * (sale - cost);
          }
          if (rows.length < pageSize) break;
        }
        if (active) { setInventoryValue(invTotal); setInventoryProfit(profitTotal); }
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
        const bp: Record<string, { total: number; byMethod: Record<string, number> }> = {};
        for (const p of (personPay ?? []) as any[]) {
          const name = String(p.person_name || "Other").trim() || "Other";
          const amt = Number(p.amount) || 0;
          const method = String(p.payment_method || "cash");
          const b = (bp[name] ??= { total: 0, byMethod: {} });
          b.total += amt;
          b.byMethod[method] = (b.byMethod[method] ?? 0) + amt;
        }
        setByPerson(bp);
        const ex = (extrasRaw as any) ?? {};
        setExtras({
          discounts: Number(ex.discounts ?? 0),
          stockPurchased: Number(ex.stockPurchased ?? 0),
          operatingExpenses: Number(ex.operatingExpenses ?? 0),
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [period, customFrom, customTo]);

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
        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex gap-1 flex-wrap">
            {PERIODS.map(p => (
              <Button key={p.key} variant={period === p.key ? "default" : "outline"} size="sm"
                onClick={() => setPeriod(p.key)}>{p.label}</Button>
            ))}
            <Button variant={period === "custom" ? "default" : "outline"} size="sm"
              onClick={() => setPeriod("custom")}>Custom</Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={customFrom} max={customTo}
              onChange={e => { setCustomFrom(e.target.value); setPeriod("custom"); }}
              className="h-8 w-[150px]" />
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={customTo} min={customFrom} max={new Date().toISOString().slice(0, 10)}
              onChange={e => { setCustomTo(e.target.value); setPeriod("custom"); }}
              className="h-8 w-[150px]" />
          </div>
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

      {/* Profit, expenses & investment (supplier payments are investment, not profit) */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Net Profit" icon={Wallet} color="var(--success)" loading={loading}
          value={<span className={(kpis.grossProfit - extras.operatingExpenses) < 0 ? "text-destructive" : "text-green-600"}>{fmt(kpis.grossProfit - extras.operatingExpenses)}</span>} />
        <StatCard label="Total Inventory (Cost)" value={fmt(inventoryValue)} icon={Package} color="var(--success)" loading={loading} />
        <StatCard label="Expected Inventory Profit" value={fmt(inventoryProfit)} icon={TrendingUp} color="var(--primary)" loading={loading} />
        <StatCard label="Operating Expenses" value={fmt(extras.operatingExpenses)} icon={Percent} color="var(--destructive)" loading={loading} />
        <StatCard label="Stock Purchased" value={fmt(extras.stockPurchased)} icon={Package} color="var(--info)" loading={loading} />
        <StatCard label="Total Discounts Given" value={fmt(extras.discounts)} icon={ShoppingCart} color="var(--warning)" loading={loading} />
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

      {/* By Person — from person_payments, grouped by person + method */}
      {Object.keys(byPerson).length > 0 && (
        <Card className="p-4 sm:p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><Users className="h-4 w-4 text-muted-foreground" /> By Person</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(byPerson).sort((a, b) => b[1].total - a[1].total).map(([name, v]) => (
              <div key={name} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{name}</div>
                <div className="text-xl font-bold mt-1">{fmt(v.total)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 break-words">
                  {Object.entries(v.byMethod).filter(([, a]) => a > 0).map(([m, a]) => `${methodLabel(m)} ${fmt(a)}`).join(" · ") || "—"}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
