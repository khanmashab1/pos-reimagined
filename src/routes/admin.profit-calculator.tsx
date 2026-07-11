import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, TrendingUp, Package, Percent, AlertTriangle, Loader2, Save } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { fmt } from "@/lib/format";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Area,
  AreaChart,
} from "recharts";

export const Route = createFileRoute("/admin/profit-calculator")({
  component: ProfitCalculator,
});

interface SaleWithItems {
  id: string;
  bill_no: string;
  cashier_name: string;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total: number;
  created_at: string;
  sale_items: Array<{
    product_id: string | null;
    product_name: string;
    barcode: string;
    qty: number;
    unit_price: number;
    purchase_price: number;
    subtotal: number;
  }>;
}

interface ProductRow {
  name: string;
  profit: number;
  qty: number;
  margin: number | null; // null => N/A (net revenue = 0)
  revenue: number;
  zero_cost: boolean;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const QUICK_FILTERS = [
  { label: "All Time", from: "2000-01-01", to: todayStr() },
  { label: "Today", from: todayStr(), to: todayStr() },
  { label: "This Week", from: daysAgo(6), to: todayStr() },
  {
    label: "This Month",
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to: todayStr(),
  },
  {
    label: "Last Month",
    from: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
      .toISOString()
      .slice(0, 10),
    to: new Date(new Date().getFullYear(), new Date().getMonth(), 0).toISOString().slice(0, 10),
  },
  {
    label: "This Year",
    from: new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10),
    to: todayStr(),
  },
  { label: "Last 30d", from: daysAgo(29), to: todayStr() },
  { label: "Last 90d", from: daysAgo(89), to: todayStr() },
];

const COLORS = [
  "hsl(142 71% 45%)",
  "hsl(210 90% 56%)",
  "hsl(38 92% 50%)",
  "hsl(0 84% 60%)",
  "hsl(280 85% 65%)",
];

/**
 * Largest-remainder allocation: split `total` (Rs, 2 dp) across `weights`
 * (line subtotals) so each share is rounded to 2 dp AND the sum equals `total`
 * exactly. Returns an array of Rs values, one per weight.
 */
function allocateWithLargestRemainder(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || total === 0) return weights.map(() => 0);
  // Exact shares scaled to paisa (integer arithmetic) for the fix-up.
  const totalPaisa = Math.round(total * 100);
  const exact = weights.map((w) => (w / sumW) * totalPaisa);
  const floors = exact.map((x) => Math.floor(x));
  let remainder = totalPaisa - floors.reduce((a, b) => a + b, 0);
  // Distribute leftover paisa to the lines with the largest fractional part.
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result.map((p) => p / 100);
}

function ProfitCalculator() {
  const [from, setFrom] = useState("2000-01-01");
  const [to, setTo] = useState(todayStr());
  const [activeFilter, setActiveFilter] = useState("All Time");
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculated metrics
  const [zeroPurchasePriceCount, setZeroPurchasePriceCount] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [profitMargin, setProfitMargin] = useState<number | null>(0);
  const [totalSales, setTotalSales] = useState(0);
  const [profitByProduct, setProfitByProduct] = useState<ProductRow[]>([]);
  const [dailyProfit, setDailyProfit] = useState<
    Array<{ date: string; profit: number; sales: number }>
  >([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; profit: number }>>([]);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);

  // Zero-cost products dialog
  const [zeroCostOpen, setZeroCostOpen] = useState(false);
  const [zeroCostProducts, setZeroCostProducts] = useState<
    Array<{ id: string; name: string; barcode: string; purchase_price: number; sale_price: number }>
  >([]);
  const [zeroCostLoading, setZeroCostLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadWithDates(fromDate: string, toDate: string) {
    setFrom(fromDate);
    setTo(toDate);
    await load(fromDate, toDate);
  }

  async function load(fromDate = from, toDate = to) {
    setLoading(true);
    // Item 3: interpret from/to as UTC in both paths (matches RPC's
    // `created_at AT TIME ZONE 'UTC'` grouping and its raw timestamptz filter).
    const fromIso = `${fromDate}T00:00:00.000Z`;
    const toIso = `${toDate}T23:59:59.999Z`;
    try {
      // Fast path: aggregate server-side and fetch a tiny summary payload.
      const { data, error: rpcError } = await supabase.rpc("get_profit_report", {
        _from: fromIso,
        _to: toIso,
      });
      if (rpcError) throw rpcError;
      applyReport(data as any);
      setError(null);

      // Item 8: dev-only consistency check — re-run the client aggregation and
      // warn if totals diverge beyond Rs. 1. Never runs in production builds.
      if (import.meta.env.DEV) {
        void devConsistencyCheck(fromIso, toIso, data as any);
      }
    } catch (rpcErr: any) {
      console.warn("get_profit_report unavailable, using client aggregation:", rpcErr?.message);
      await legacyLoad(fromIso, toIso);
    } finally {
      setLoading(false);
    }
  }

  /** Map the pre-aggregated server payload into the chart/table state. */
  function applyReport(r: any) {
    const products: ProductRow[] = ((r?.by_product ?? []) as any[]).map((p) => ({
      name: p.name,
      profit: Number(p.profit) || 0,
      qty: Number(p.qty) || 0,
      revenue: Number(p.revenue) || 0,
      // Item 7: server returns null when net revenue = 0 → render as N/A.
      margin: p.margin == null ? null : Number(p.margin) || 0,
      zero_cost: Boolean(p.zero_cost),
    }));
    const daily = ((r?.daily ?? []) as any[]).map((d) => ({
      date: d.date,
      profit: Number(d.profit) || 0,
      sales: Number(d.sales) || 0,
    }));
    const revenue = Number(r?.total_revenue) || 0;
    const profit = Number(r?.total_profit) || 0;
    setSales([]);
    setZeroPurchasePriceCount(Number(r?.zero_count) || 0);
    setTotalSales(revenue);
    setTotalProfit(profit);
    setProfitMargin(revenue > 0 ? (profit / revenue) * 100 : null);
    setProfitByProduct(products);
    setTopProducts(products.slice(0, 5));
    setDailyProfit(daily);
  }

  async function legacyLoad(fromIso: string, toIso: string) {
    try {
      const SALES_PAGE = 1000;
      let salesData: any[] = [];
      let salesPage = 0;
      while (true) {
        const { data: batch, error: salesError } = await supabase
          .from("sales")
          .select("id,bill_no,cashier_name,subtotal,tax_amount,discount,total,created_at")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: true })
          .range(salesPage * SALES_PAGE, salesPage * SALES_PAGE + SALES_PAGE - 1);

        if (salesError) {
          console.error("Sales fetch error:", salesError);
          setError("Failed to load sales data");
          setSales([]);
          return;
        }
        salesData = salesData.concat(batch ?? []);
        if (!batch || batch.length < SALES_PAGE) break;
        salesPage++;
      }

      if (salesData.length === 0) {
        setSales([]);
        await calculateMetrics([], fromIso, toIso);
        setError(null);
        return;
      }

      const saleIds = (salesData as any[]).map((s) => s.id);
      const CHUNK = 200;
      let allItems: any[] = [];
      for (let i = 0; i < saleIds.length; i += CHUNK) {
        const chunk = saleIds.slice(i, i + CHUNK);
        const { data: chunkItems, error: itemsError } = await supabase
          .from("sale_items")
          .select("sale_id,product_id,product_name,barcode,qty,unit_price,purchase_price,subtotal")
          .in("sale_id", chunk)
          .range(0, 9999);
        if (itemsError) {
          console.error("Items fetch error:", itemsError);
          setError("Failed to load sale items");
          return;
        }
        allItems = allItems.concat(chunkItems ?? []);
      }

      const itemsBySale: Record<string, any[]> = {};
      (allItems ?? []).forEach((item: any) => {
        if (!itemsBySale[item.sale_id]) itemsBySale[item.sale_id] = [];
        itemsBySale[item.sale_id].push(item);
      });

      const salesWithItems = (salesData as any[]).map((s) => ({
        ...s,
        sale_items: itemsBySale[s.id] ?? [],
      }));

      setSales(salesWithItems);
      await calculateMetrics(salesWithItems, fromIso, toIso);
      setError(null);
    } catch (err) {
      console.error("Load error:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setSales([]);
    }
  }

  /**
   * Client aggregation. Applies:
   *  - Item 4: proportional discount allocation per line with largest-remainder fix-up.
   *  - Item 1: subtracts approved returns (revenue + matched cost from original sale_items).
   *  - Item 5: uses stored sale_items.purchase_price (never re-joins products).
   *  - Item 7: null margin when net revenue = 0.
   */
  async function calculateMetrics(salesData: SaleWithItems[], fromIso: string, toIso: string) {
    // --- Fetch approved returns in period, matched to original sale_items for cost ---
    type ReturnLine = { name: string; date: string; qty: number; revenue: number; cost: number };
    const returnLines: ReturnLine[] = [];
    try {
      const { data: approvedReturns } = await supabase
        .from("returns")
        .select("id,original_sale_id,created_at,approved_at,status")
        .eq("status", "approved")
        .gte("approved_at", fromIso)
        .lte("approved_at", toIso);

      const rIds = (approvedReturns ?? []).map((r: any) => r.id);
      if (rIds.length > 0) {
        // return_items in chunks
        const CHUNK = 200;
        let rItems: any[] = [];
        for (let i = 0; i < rIds.length; i += CHUNK) {
          const { data: batch } = await supabase
            .from("return_items")
            .select("return_id,product_id,product_name,qty,unit_price,subtotal")
            .in("return_id", rIds.slice(i, i + CHUNK))
            .range(0, 9999);
          rItems = rItems.concat(batch ?? []);
        }
        // Cost lookup: original sale_items (sale_id + product_id) → purchase_price
        const origSaleIds = Array.from(
          new Set((approvedReturns ?? []).map((r: any) => r.original_sale_id).filter(Boolean)),
        );
        const costByKey = new Map<string, number>();
        for (let i = 0; i < origSaleIds.length; i += CHUNK) {
          const { data: origItems } = await supabase
            .from("sale_items")
            .select("sale_id,product_id,purchase_price")
            .in("sale_id", origSaleIds.slice(i, i + CHUNK))
            .range(0, 9999);
          (origItems ?? []).forEach((it: any) => {
            if (it.product_id) {
              costByKey.set(`${it.sale_id}:${it.product_id}`, Number(it.purchase_price) || 0);
            }
          });
        }
        const retById = new Map<string, any>();
        (approvedReturns ?? []).forEach((r: any) => retById.set(r.id, r));
        for (const it of rItems) {
          const r = retById.get(it.return_id);
          if (!r) continue;
          const cost = costByKey.get(`${r.original_sale_id}:${it.product_id}`) ?? 0;
          const qty = Number(it.qty) || 0;
          returnLines.push({
            name: it.product_name || "Unknown",
            date: new Date(r.approved_at || r.created_at).toISOString().slice(0, 10),
            qty,
            revenue: qty * (Number(it.unit_price) || 0),
            cost: qty * cost,
          });
        }
      }
    } catch (e) {
      console.warn("Returns fetch failed (skipping return offsets):", e);
    }

    if (salesData.length === 0 && returnLines.length === 0) {
      setTotalProfit(0);
      setProfitMargin(null);
      setTotalSales(0);
      setProfitByProduct([]);
      setDailyProfit([]);
      setTopProducts([]);
      setZeroPurchasePriceCount(0);
      return;
    }

    let totalRevenue = 0;
    let totalCost = 0;
    let zeroCount = 0;
    const profitMap: Record<
      string,
      { profit: number; qty: number; revenue: number; zero_cost: boolean }
    > = {};
    const dailyMap: Record<string, { profit: number; sales: number }> = {};

    for (const sale of salesData) {
      const saleDate = new Date(sale.created_at).toISOString().slice(0, 10); // UTC
      const items = sale.sale_items ?? [];
      const grossLine = items.map((it) => (Number(it.qty) || 0) * (Number(it.unit_price) || 0));
      const saleDiscount = Number(sale.discount) || 0;
      // Item 4: allocate discount with largest-remainder correction so shares
      // sum EXACTLY to sale.discount when rounded to 2 dp.
      const discountShare = saleDiscount > 0
        ? allocateWithLargestRemainder(saleDiscount, grossLine)
        : grossLine.map(() => 0);

      let saleRevenue = 0;
      let saleCost = 0;
      items.forEach((item, idx) => {
        const qty = Number(item.qty) || 0;
        const unitPrice = Number(item.unit_price) || 0;
        // Item 5: purchase_price is the stored snapshot from sale_items.
        const purchasePrice = Number(item.purchase_price) || 0;
        if (purchasePrice === 0) zeroCount++;

        const gross = qty * unitPrice;
        const itemRevenue = gross - (discountShare[idx] ?? 0);
        const itemCost = qty * purchasePrice;
        const itemProfit = itemRevenue - itemCost;

        saleRevenue += itemRevenue;
        saleCost += itemCost;

        const key = item.product_name || "Unknown";
        if (!profitMap[key]) profitMap[key] = { profit: 0, qty: 0, revenue: 0, zero_cost: false };
        profitMap[key].profit += itemProfit;
        profitMap[key].qty += qty;
        profitMap[key].revenue += itemRevenue;
        if (purchasePrice === 0) profitMap[key].zero_cost = true;
      });

      totalRevenue += saleRevenue;
      totalCost += saleCost;
      if (!dailyMap[saleDate]) dailyMap[saleDate] = { profit: 0, sales: 0 };
      dailyMap[saleDate].profit += saleRevenue - saleCost;
      dailyMap[saleDate].sales += saleRevenue;
    }

    // Item 1: subtract approved returns from revenue, cost, and profit.
    for (const rl of returnLines) {
      totalRevenue -= rl.revenue;
      totalCost -= rl.cost;
      const key = rl.name;
      if (!profitMap[key]) profitMap[key] = { profit: 0, qty: 0, revenue: 0, zero_cost: false };
      profitMap[key].profit -= rl.revenue - rl.cost;
      profitMap[key].qty -= rl.qty;
      profitMap[key].revenue -= rl.revenue;
      if (!dailyMap[rl.date]) dailyMap[rl.date] = { profit: 0, sales: 0 };
      dailyMap[rl.date].profit -= rl.revenue - rl.cost;
      dailyMap[rl.date].sales -= rl.revenue;
    }

    const profit = totalRevenue - totalCost;
    // Item 7: null margin when net revenue = 0 → UI shows "N/A".
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : null;

    setZeroPurchasePriceCount(zeroCount);
    setTotalProfit(profit);
    setTotalSales(totalRevenue);
    setProfitMargin(margin);

    const products: ProductRow[] = Object.entries(profitMap)
      .map(([name, data]) => ({
        name,
        profit: data.profit,
        qty: data.qty,
        revenue: data.revenue,
        margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : null,
        zero_cost: data.zero_cost,
      }))
      .sort((a, b) => b.profit - a.profit);

    setProfitByProduct(products);
    setTopProducts(products.slice(0, 5));

    const daily = Object.entries(dailyMap)
      .map(([date, data]) => ({
        date,
        profit: Math.round(data.profit),
        sales: Math.round(data.sales),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDailyProfit(daily);
  }

  /**
   * Item 8: dev-only cross-check. Compares the RPC totals with a re-run of the
   * client aggregation. Emits a console.warn if any total drifts by more than
   * Rs. 1. Never runs in production because it's gated on `import.meta.env.DEV`.
   */
  async function devConsistencyCheck(fromIso: string, toIso: string, rpcData: any) {
    try {
      // Fetch a stripped-down sales+items snapshot, same shape legacyLoad uses.
      const { data: salesRows } = await supabase
        .from("sales")
        .select("id,bill_no,cashier_name,subtotal,tax_amount,discount,total,created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true })
        .range(0, 9999);
      const rows = (salesRows ?? []) as any[];
      const ids = rows.map((r) => r.id);
      let items: any[] = [];
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: batch } = await supabase
          .from("sale_items")
          .select("sale_id,product_id,product_name,barcode,qty,unit_price,purchase_price,subtotal")
          .in("sale_id", ids.slice(i, i + CHUNK))
          .range(0, 9999);
        items = items.concat(batch ?? []);
      }
      const bySale: Record<string, any[]> = {};
      items.forEach((it) => {
        (bySale[it.sale_id] ||= []).push(it);
      });
      const merged = rows.map((s) => ({ ...s, sale_items: bySale[s.id] ?? [] }));

      // Recompute locally without mutating component state.
      let cRev = 0;
      let cCost = 0;
      for (const s of merged) {
        const gross = (s.sale_items as any[]).map(
          (it) => (Number(it.qty) || 0) * (Number(it.unit_price) || 0),
        );
        const disc = Number(s.discount) || 0;
        const shares = disc > 0 ? allocateWithLargestRemainder(disc, gross) : gross.map(() => 0);
        (s.sale_items as any[]).forEach((it, i) => {
          const q = Number(it.qty) || 0;
          cRev += q * (Number(it.unit_price) || 0) - (shares[i] ?? 0);
          cCost += q * (Number(it.purchase_price) || 0);
        });
      }
      // Approved returns
      const { data: rets } = await supabase
        .from("returns")
        .select("id,original_sale_id,approved_at")
        .eq("status", "approved")
        .gte("approved_at", fromIso)
        .lte("approved_at", toIso);
      const rIds = (rets ?? []).map((r: any) => r.id);
      if (rIds.length > 0) {
        let rItems: any[] = [];
        for (let i = 0; i < rIds.length; i += CHUNK) {
          const { data: b } = await supabase
            .from("return_items")
            .select("return_id,product_id,qty,unit_price")
            .in("return_id", rIds.slice(i, i + CHUNK))
            .range(0, 9999);
          rItems = rItems.concat(b ?? []);
        }
        const origIds = Array.from(new Set((rets ?? []).map((r: any) => r.original_sale_id).filter(Boolean)));
        const costByKey = new Map<string, number>();
        for (let i = 0; i < origIds.length; i += CHUNK) {
          const { data: oi } = await supabase
            .from("sale_items")
            .select("sale_id,product_id,purchase_price")
            .in("sale_id", origIds.slice(i, i + CHUNK))
            .range(0, 9999);
          (oi ?? []).forEach((it: any) => {
            if (it.product_id)
              costByKey.set(`${it.sale_id}:${it.product_id}`, Number(it.purchase_price) || 0);
          });
        }
        const retById = new Map<string, any>();
        (rets ?? []).forEach((r: any) => retById.set(r.id, r));
        for (const it of rItems) {
          const r = retById.get(it.return_id);
          if (!r) continue;
          const q = Number(it.qty) || 0;
          cRev -= q * (Number(it.unit_price) || 0);
          cCost -= q * (costByKey.get(`${r.original_sale_id}:${it.product_id}`) ?? 0);
        }
      }

      const cProfit = cRev - cCost;
      const rRev = Number(rpcData?.total_revenue) || 0;
      const rCost = Number(rpcData?.total_cost) || 0;
      const rProfit = Number(rpcData?.total_profit) || 0;
      const TOL = 1; // Rs. 1
      const diffs = {
        revenue: Math.abs(cRev - rRev),
        cost: Math.abs(cCost - rCost),
        profit: Math.abs(cProfit - rProfit),
      };
      if (diffs.revenue > TOL || diffs.cost > TOL || diffs.profit > TOL) {
        console.warn(
          "[profit-calculator][dev] RPC vs client aggregation divergence > Rs. 1",
          { rpc: { revenue: rRev, cost: rCost, profit: rProfit }, client: { revenue: cRev, cost: cCost, profit: cProfit }, diffs },
        );
      }
    } catch (e) {
      console.warn("[profit-calculator][dev] consistency check failed:", e);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleDateChange() {
    load(from, to);
  }

  async function loadZeroCostProducts() {
    setZeroCostLoading(true);
    setZeroCostOpen(true);
    try {
      const { data } = await supabase
        .from("products")
        .select("id,name,barcode,purchase_price,sale_price")
        .eq("purchase_price", 0)
        .eq("is_active", true)
        .order("name");
      setZeroCostProducts((data ?? []) as any[]);
    } catch (err) {
      console.error("Error loading zero-cost products:", err);
    } finally {
      setZeroCostLoading(false);
    }
  }

  async function updatePurchasePrice(id: string, price: number) {
    setSavingId(id);
    try {
      const { error } = await supabase
        .from("products")
        .update({ purchase_price: price })
        .eq("id", id);
      if (error) {
        console.error("Update error:", error);
        return;
      }
      setZeroCostProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setSavingId(null);
    }
  }


  function exportCSV() {
    const rows = [
      ["Product", "Quantity Sold", "Revenue", "Cost", "Profit", "Margin %"],
      ...profitByProduct.map((p) => [
        p.name,
        p.qty,
        p.revenue,
        p.revenue - p.profit,
        p.profit,
        p.margin.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-calculator-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <TrendingUp className="h-7 w-7" /> Profit Calculator
        </h1>
        <p className="text-muted-foreground">Analyze revenue, costs, and profitability</p>
      </div>

      {/* Quick filter buttons */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_FILTERS.map((f) => (
            <Button
              key={f.label}
              size="sm"
              variant={activeFilter === f.label ? "default" : "outline"}
              onClick={() => {
                setActiveFilter(f.label);
                // Load directly with the filter's dates — no useState delay
                loadWithDates(f.from, f.to);
              }}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <Label>From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setActiveFilter("Custom");
              }}
            />
          </div>
          <div>
            <Label>To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setActiveFilter("Custom");
              }}
            />
          </div>
          <Button onClick={handleDateChange} disabled={loading}>
            {loading ? "Loading..." : "Load"}
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={!profitByProduct.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </Card>

      {/* Warning: products with no purchase price */}
      {zeroPurchasePriceCount > 0 && (
        <Card className="p-4 border-l-4 border-l-yellow-500 bg-yellow-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-yellow-800 font-medium">
                <AlertTriangle className="h-4 w-4" /> Inaccurate profit data
              </div>
              <div className="text-sm text-yellow-700 mt-1">
                {zeroPurchasePriceCount} sale line(s) have <strong>purchase price = Rs. 0</strong>,
                so profit equals revenue for those items. Set the buying price for affected products
                to fix future calculations.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-yellow-500 text-yellow-800 hover:bg-yellow-100"
              onClick={loadZeroCostProducts}
            >
              <Package className="h-4 w-4 mr-1" /> Fix Now
            </Button>
          </div>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <Card className="p-4 border-l-4 border-l-red-500 bg-red-50">
          <div className="text-red-700 font-medium">{error}</div>
          <div className="text-sm text-red-600 mt-1">
            Please check the date range and try again.
          </div>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-6 space-y-2 border-l-4 border-l-green-500">
          <div className="text-sm font-medium text-muted-foreground">Total Profit</div>
          <div className="text-3xl font-bold text-green-600">{fmt(totalProfit)}</div>
          <div className="text-xs text-muted-foreground">
            Period {from} to {to}
          </div>
        </Card>

        <Card className="p-6 space-y-2 border-l-4 border-l-blue-500">
          <div className="text-sm font-medium text-muted-foreground">Total Revenue</div>
          <div className="text-3xl font-bold text-blue-600">{fmt(totalSales)}</div>
          <div className="text-xs text-muted-foreground">All sales in period</div>
        </Card>

        <Card className="p-6 space-y-2 border-l-4 border-l-purple-500">
          <div className="text-sm font-medium text-muted-foreground">Profit Margin</div>
          <div className="text-3xl font-bold text-purple-600">{profitMargin.toFixed(2)}%</div>
          <div className="text-xs text-muted-foreground">Revenue-to-profit ratio</div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Daily Profit Trend */}
        {dailyProfit.length > 0 && (
          <Card className="p-6">
            <h2 className="font-semibold mb-4">Daily Profit Trend</h2>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={dailyProfit} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="profit"
                  fill="hsl(142 71% 45%)"
                  stroke="hsl(142 71% 45%)"
                  name="Profit"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="sales"
                  stroke="hsl(210 90% 56%)"
                  strokeWidth={2}
                  name="Revenue"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        )}

        {/* Top Products by Profit */}
        {topProducts.length > 0 && (
          <Card className="p-6">
            <h2 className="font-semibold mb-4">Top 5 Products by Profit</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topProducts}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="profit" fill="hsl(142 71% 45%)" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}
      </div>

      {/* Detailed Product Table */}
      <Card className="p-6">
        <h2 className="font-semibold mb-4">Product Profit Breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left px-4 py-2">Product Name</th>
                <th className="text-right px-4 py-2">Qty Sold</th>
                <th className="text-right px-4 py-2">Revenue</th>
                <th className="text-right px-4 py-2">Cost</th>
                <th className="text-right px-4 py-2">Profit</th>
                <th className="text-right px-4 py-2">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {profitByProduct.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">
                    No sales data for selected period
                  </td>
                </tr>
              ) : (
                profitByProduct.map((p, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="text-right px-4 py-2">{p.qty}</td>
                    <td className="text-right px-4 py-2">{fmt(p.revenue)}</td>
                    <td className="text-right px-4 py-2">{fmt(p.revenue - p.profit)}</td>
                    <td className="text-right px-4 py-2 font-semibold text-green-600">
                      {fmt(p.profit)}
                    </td>
                    <td className="text-right px-4 py-2">
                      <span
                        className={`font-semibold ${p.margin >= 30 ? "text-green-600" : p.margin >= 15 ? "text-yellow-600" : "text-red-600"}`}
                      >
                        {p.margin.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Zero-cost products dialog */}
      <Dialog open={zeroCostOpen} onOpenChange={setZeroCostOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              Products with No Purchase Price
            </DialogTitle>
          </DialogHeader>
          {zeroCostLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : zeroCostProducts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="font-medium">All products have purchase prices set</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-auto">
              {zeroCostProducts.map((p) => (
                <div
                  key={p.id}
                  data-product-id={p.id}
                  className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{p.barcode}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    Sale: <span className="font-semibold text-foreground">{fmt(p.sale_price)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      className="w-24 h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          if (!isNaN(val) && val >= 0) updatePurchasePrice(p.id, val);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 p-0"
                      disabled={savingId === p.id}
                      onClick={(e) => {
                        const input = e.currentTarget
                          .closest("[data-product-id]")
                          ?.querySelector("input") as HTMLInputElement | null;
                        if (input) {
                          const val = parseFloat(input.value);
                          if (!isNaN(val) && val >= 0) updatePurchasePrice(p.id, val);
                        }
                      }}
                    >
                      {savingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setZeroCostOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
