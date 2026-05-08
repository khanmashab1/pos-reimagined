import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, TrendingUp, Package, Percent } from "lucide-react";
import { fmt } from "@/lib/format";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ComposedChart, Area, AreaChart,
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

function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

const COLORS = ["hsl(142 71% 45%)", "hsl(210 90% 56%)", "hsl(38 92% 50%)", "hsl(0 84% 60%)", "hsl(280 85% 65%)"];

function ProfitCalculator() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculated metrics
  const [totalProfit, setTotalProfit] = useState(0);
  const [profitMargin, setProfitMargin] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [profitByProduct, setProfitByProduct] = useState<Array<{ name: string; profit: number; qty: number; margin: number; revenue: number }>>([]);
  const [dailyProfit, setDailyProfit] = useState<Array<{ date: string; profit: number; sales: number }>>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; profit: number }>([]);

  async function load() {
    setLoading(true);
    try {
      const fromIso = new Date(from + "T00:00:00").toISOString();
      const toIso = new Date(to + "T23:59:59.999").toISOString();

      const { data: salesData, error: salesError } = await supabase
        .from("sales")
        .select("id,bill_no,cashier_name,subtotal,tax_amount,discount,total,created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: true });

      if (salesError) {
        console.error("Sales fetch error:", salesError);
        setError("Failed to load sales data");
        setSales([]);
        return;
      }

      if (!salesData || salesData.length === 0) {
        setSales([]);
        calculateMetrics([]);
        setError(null);
        return;
      }

      // Fetch all sale items for the period at once
      const saleIds = (salesData as any[]).map(s => s.id);
      const { data: allItems, error: itemsError } = await supabase
        .from("sale_items")
        .select("sale_id,product_id,product_name,barcode,qty,unit_price,purchase_price,subtotal")
        .in("sale_id", saleIds);

      if (itemsError) {
        console.error("Items fetch error:", itemsError);
        setError("Failed to load sale items");
        return;
      }

      // Group items by sale_id
      const itemsBySale: Record<string, any[]> = {};
      (allItems ?? []).forEach((item: any) => {
        if (!itemsBySale[item.sale_id]) itemsBySale[item.sale_id] = [];
        itemsBySale[item.sale_id].push(item);
      });

      // Combine sales with their items
      const salesWithItems = (salesData as any[]).map(s => ({
        ...s,
        sale_items: itemsBySale[s.id] ?? [],
      }));

      setSales(salesWithItems);
      calculateMetrics(salesWithItems);
      setError(null);
    } catch (err) {
      console.error("Load error:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setSales([]);
    } finally {
      setLoading(false);
    }
  }

  function calculateMetrics(salesData: SaleWithItems[]) {
    if (salesData.length === 0) {
      setTotalProfit(0);
      setProfitMargin(0);
      setTotalSales(0);
      setProfitByProduct([]);
      setDailyProfit([]);
      setTopProducts([]);
      return;
    }

    let totalRevenue = 0;
    let totalCost = 0;
    const profitMap: Record<string, { profit: number; qty: number; revenue: number }> = {};
    const dailyMap: Record<string, { profit: number; sales: number }> = {};

    for (const sale of salesData) {
      const saleDate = new Date(sale.created_at).toISOString().slice(0, 10);
      let saleCost = 0;
      let saleRevenue = 0;

      for (const item of sale.sale_items) {
        const qty = Number(item.qty) || 0;
        const unitPrice = Number(item.unit_price) || 0;
        const purchasePrice = Number(item.purchase_price) || 0;
        
        const itemRevenue = qty * unitPrice;
        const itemCost = qty * purchasePrice;
        const itemProfit = itemRevenue - itemCost;

        saleRevenue += itemRevenue;
        saleCost += itemCost;

        // Track by product
        const productKey = item.product_name || "Unknown";
        if (!profitMap[productKey]) {
          profitMap[productKey] = { profit: 0, qty: 0, revenue: 0 };
        }
        profitMap[productKey].profit += itemProfit;
        profitMap[productKey].qty += qty;
        profitMap[productKey].revenue += itemRevenue;
      }

      totalRevenue += saleRevenue;
      totalCost += saleCost;

      // Track daily
      if (!dailyMap[saleDate]) {
        dailyMap[saleDate] = { profit: 0, sales: 0 };
      }
      dailyMap[saleDate].profit += saleRevenue - saleCost;
      dailyMap[saleDate].sales += saleRevenue;
    }

    const profit = totalRevenue - totalCost;
    const margin = totalRevenue > 0 ? ((profit / totalRevenue) * 100) : 0;

    setTotalProfit(profit);
    setTotalSales(totalRevenue);
    setProfitMargin(margin);

    // Product breakdown
    const products = Object.entries(profitMap)
      .map(([name, data]) => ({
        name,
        profit: data.profit,
        qty: data.qty,
        revenue: data.revenue,
        margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit);

    setProfitByProduct(products);
    setTopProducts(products.slice(0, 5));

    // Daily trends
    const daily = Object.entries(dailyMap)
      .map(([date, data]) => ({
        date,
        profit: Math.round(data.profit),
        sales: Math.round(data.sales),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    setDailyProfit(daily);
  }

  useEffect(() => { load(); }, []);

  function handleDateChange() {
    load();
  }

  function exportCSV() {
    const rows = [
      ["Product", "Quantity Sold", "Revenue", "Cost", "Profit", "Margin %"],
      ...profitByProduct.map(p => [
        p.name,
        p.qty,
        p.revenue,
        p.revenue - p.profit,
        p.profit,
        p.margin.toFixed(2),
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
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
        <h1 className="text-3xl font-bold flex items-center gap-2"><TrendingUp className="h-7 w-7" /> Profit Calculator</h1>
        <p className="text-muted-foreground">Analyze revenue, costs, and profitability</p>
      </div>

      {/* Date range filter */}
      <Card className="p-5">
        <div className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <Button onClick={handleDateChange} disabled={loading}>
            Load
          </Button>
          <Button variant="outline" onClick={exportCSV} disabled={!profitByProduct.length}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>
      </Card>

      {/* Error message */}
      {error && (
        <Card className="p-4 border-l-4 border-l-red-500 bg-red-50">
          <div className="text-red-700 font-medium">{error}</div>
          <div className="text-sm text-red-600 mt-1">Please check the date range and try again.</div>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-6 space-y-2 border-l-4 border-l-green-500">
          <div className="text-sm font-medium text-muted-foreground">Total Profit</div>
          <div className="text-3xl font-bold text-green-600">{fmt(totalProfit)}</div>
          <div className="text-xs text-muted-foreground">Period {from} to {to}</div>
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
                <Area yAxisId="left" type="monotone" dataKey="profit" fill="hsl(142 71% 45%)" stroke="hsl(142 71% 45%)" name="Profit" />
                <Line yAxisId="right" type="monotone" dataKey="sales" stroke="hsl(210 90% 56%)" strokeWidth={2} name="Revenue" />
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
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">No sales data for selected period</td>
                </tr>
              ) : (
                profitByProduct.map((p, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="text-right px-4 py-2">{p.qty}</td>
                    <td className="text-right px-4 py-2">{fmt(p.revenue)}</td>
                    <td className="text-right px-4 py-2">{fmt(p.revenue - p.profit)}</td>
                    <td className="text-right px-4 py-2 font-semibold text-green-600">{fmt(p.profit)}</td>
                    <td className="text-right px-4 py-2">
                      <span className={`font-semibold ${p.margin >= 30 ? "text-green-600" : p.margin >= 15 ? "text-yellow-600" : "text-red-600"}`}>
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
    </div>
  );
}
