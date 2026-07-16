import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Loader2, Plus, Minus, Trash2, ScanLine, ShoppingCart, X, Store,
  LogOut, LayoutDashboard, Camera, PlayCircle, StopCircle, CreditCard,
  Banknote, RotateCcw, Package, Tag, Truck, HandCoins,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import { Receipt } from "@/components/Receipt";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StartShiftDialog, CloseShiftDialog, ExpenseDialog, type OpenSession } from "@/components/ShiftDialog";
import { MidnightCounterCashDialog } from "@/components/MidnightCounterCashDialog";
import { QuickAddProductDialog, type QuickAddProduct } from "@/components/QuickAddProductDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchUnitsByProductIds, pickDefaultUnit, type ProductUnit } from "@/lib/units";

export const Route = createFileRoute("/pos")({
  component: PosPage,
});

interface Product {
  id: string; barcode: string; name: string; sale_price: number;
  purchase_price: number; stock: number; category_id: string | null;
}
interface CartItem extends Product {
  qty: number;
  unit_id: string | null;
  unit_name: string;
  unit_equals_base: number;
  unit_sale_price: number;
  unit_purchase_price: number;
  available_units: ProductUnit[];
}

type PaymentMethod = "cash" | "card" | "easypasa" | "jazzcash";

/** One cart row. Memoized so editing/adding one item doesn't re-render every other row. */
const CartItemRow = memo(function CartItemRow({
  i,
  idx,
  onUpdate,
  onRemove,
}: {
  i: CartItem;
  idx: number;
  onUpdate: (idx: number, patch: Partial<CartItem>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div
      className="grid gap-1 px-2 sm:px-4 py-2 items-center hover:bg-muted/30 transition-colors"
      style={{ gridTemplateColumns: "1fr 5rem 6rem 4rem 2rem" }}>
      <div className="min-w-0">
        <div className="font-medium text-xs sm:text-sm truncate">{i.name}</div>
        <div className="sm:hidden text-[10px] text-muted-foreground">{fmt(i.unit_sale_price)} / {i.unit_name}</div>
      </div>
      <div className="hidden sm:block">
        {i.available_units.length > 1 ? (
          <Select
            value={i.unit_id ?? ""}
            onValueChange={(v) => {
              const u = i.available_units.find((x) => x.id === v);
              if (!u) return;
              onUpdate(idx, {
                unit_id: u.id,
                unit_name: u.name,
                unit_equals_base: u.equals_base,
                unit_sale_price: Number(u.sale_price),
                unit_purchase_price: Number(u.purchase_price),
              });
            }}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {i.available_units.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name} · {fmt(Number(u.sale_price))}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="text-right text-xs">{fmt(i.unit_sale_price)}</div>
        )}
      </div>
      <div className="flex items-center justify-center gap-0.5 sm:gap-1">
        <Button size="icon" variant="ghost" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0"
          onClick={() => onUpdate(idx, { qty: Math.max(1, i.qty - 1) })}>
          <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        </Button>
        <input
          type="number" min={1}
          className="w-7 sm:w-10 text-center text-xs sm:text-sm font-semibold bg-transparent border border-border rounded px-0.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={i.qty}
          onChange={e => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 1) onUpdate(idx, { qty: val });
          }}
          onBlur={e => {
            const val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 1) onUpdate(idx, { qty: 1 });
          }}
        />
        <Button size="icon" variant="ghost" className="h-5 w-5 sm:h-6 sm:w-6 shrink-0"
          onClick={() => onUpdate(idx, { qty: i.qty + 1 })}>
          <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
        </Button>
      </div>
      <div className="text-right text-xs sm:text-sm font-semibold">{fmt(i.qty * Number(i.unit_sale_price))}</div>
      <button
        className="flex items-center justify-center h-6 w-6 rounded text-red-500 hover:text-red-700 hover:bg-red-100"
        onClick={() => onRemove(idx)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

function PosPage() {
  const { loading, user, role, signOut, fullName } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 60;
  const [discount, setDiscount] = useState(0);
  const [cash, setCash] = useState<string>("");
  const [taxRate, setTaxRate] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [session, setSession] = useState<OpenSession | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<Product[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const manualSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddBarcode, setQuickAddBarcode] = useState<string>("");
  const isMobile = useIsMobile();
  const scanRef = useRef<HTMLInputElement>(null);
  // In-memory cache of product units, keyed by product id, so adding to cart is instant
  // (no per-click DB round-trip). A ref avoids re-renders since nothing renders from it.
  const unitsCache = useRef<Record<string, ProductUnit[]>>({});

  const refreshSession = useCallback(async () => {
    const { data } = await supabase.rpc("get_open_session");
    setSession((data as unknown as OpenSession) ?? null);
    setShiftLoading(false);
  }, []);

  useEffect(() => { if (user) refreshSession(); }, [user, refreshSession]);

  // Batch-prefetch units for the products currently on screen, merging into the cache.
  const prefetchUnits = useCallback(async (list: { id: string }[]) => {
    const missing = list.map((p) => p.id).filter((id) => !(id in unitsCache.current));
    if (missing.length === 0) return;
    const map = await fetchUnitsByProductIds(missing);
    const next = { ...unitsCache.current };
    for (const id of missing) next[id] = map[id] ?? [];
    unitsCache.current = next;
  }, []);

  // Stable cart mutators so memoized rows don't re-render from new callback identities.
  const updateCartItem = useCallback((idx: number, patch: Partial<CartItem>) => {
    setCart((c) => c.map((it, j) => (j === idx ? { ...it, ...patch } : it)));
  }, []);
  const removeCartItem = useCallback((idx: number) => {
    setCart((c) => c.filter((_, j) => j !== idx));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    (async () => {
      const [{ data: c }, { data: s }] = await Promise.all([
        supabase.from("categories").select("id,name").order("name"),
        supabase.from("store_settings").select("tax_rate").eq("id", 1).single(),
      ]);
      setCats(c ?? []);
      setTaxRate(Number(s?.tax_rate ?? 0));
    })();
  }, []);

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(async () => {
      try {
        // If searching, also match per-unit barcodes so products whose Box/Half-Box barcode
        // is scanned/typed still appear in the grid.
        let extraIds: string[] = [];
        if (search) {
          const { data: unitMatches } = await supabase
            .from("product_units")
            .select("product_id")
            .ilike("barcode", `%${search}%`)
            .limit(50);
          extraIds = Array.from(new Set((unitMatches ?? []).map((u: { product_id: string }) => u.product_id)));
        }
        let q = supabase
          .from("products")
          .select("*", { count: "exact" })
          .eq("is_active", true)
          .order("name")
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (cat !== "all") q = q.eq("category_id", cat);
        if (search) {
          const idFilter = extraIds.length ? `,id.in.(${extraIds.join(",")})` : "";
          q = q.or(`name.ilike.%${search}%,barcode.ilike.%${search}%${idFilter}`);
        }
        const { data: p, count, error } = await q;
        if (error) { console.error("Products fetch error:", error); return; }
        if (!cancelled) { setProducts((p ?? []) as Product[]); setTotalCount(count ?? 0); }
      } catch (err) { console.error("Products fetch error:", err); }
    }, search ? 350 : 0);
    return () => { cancelled = true; if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };

  }, [page, search, cat]);

  useEffect(() => { setPage(0); }, [search, cat]);
  useEffect(() => { scanRef.current?.focus(); }, []);

  const addToCart = useCallback(async (p: Product, opts?: { unit?: ProductUnit; qty?: number }) => {
    // Read units from the prefetched cache (instant). Only hit the network on a cache miss —
    // e.g. a scanned product that isn't on the current screen.
    let units = unitsCache.current[p.id];
    if (units === undefined) {
      const map = await fetchUnitsByProductIds([p.id]);
      units = map[p.id] ?? [];
      unitsCache.current = { ...unitsCache.current, [p.id]: units };
    }
    const unit = opts?.unit ?? pickDefaultUnit(units);
    const addQty = opts?.qty ?? 1;
    setCart((prev) => {
      const matchKey = (i: CartItem) => i.id === p.id && i.unit_id === (unit?.id ?? null);
      const ex = prev.find(matchKey);
      if (ex) return prev.map((i) => (matchKey(i) ? { ...i, qty: i.qty + addQty } : i));
      return [
        ...prev,
        {
          ...p,
          qty: addQty,
          unit_id: unit?.id ?? null,
          unit_name: unit?.name ?? "Piece",
          unit_equals_base: unit?.equals_base ?? 1,
          unit_sale_price: unit ? Number(unit.sale_price) : Number(p.sale_price),
          unit_purchase_price: unit ? Number(unit.purchase_price) : Number(p.purchase_price),
          available_units: units,
        },
      ];
    });
  }, []);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); processSale(); }
      if (e.key === "F4") { e.preventDefault(); if (confirm("Clear cart?")) setCart([]); }
      if (e.key === "Escape") { scanRef.current?.focus(); }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, []);

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim().replace(/[\s\-]/g, '');
    if (!code) return;
    // 1) match product barcode
    let prod: Product | undefined = products.find(p => p.barcode === code);
    if (!prod) {
      const { data } = await supabase.from("products").select("*").eq("barcode", code).eq("is_active", true).maybeSingle();
      prod = (data as Product) ?? undefined;
    }
    if (prod) { await addToCart(prod); toast.success(`Added: ${prod.name}`); setScan(""); return; }
    // 2) match unit barcode (two queries: avoid the ambiguous product_units<->products embed)
    const { data: unitRow } = await supabase.from("product_units").select("*").eq("barcode", code).maybeSingle();
    if (unitRow) {
      const unit = unitRow as unknown as ProductUnit;
      const { data: parent } = await supabase.from("products").select("*").eq("id", unit.product_id).eq("is_active", true).maybeSingle();
      if (parent) {
        await addToCart(parent as Product, { unit });
        toast.success(`Added: ${(parent as Product).name} (${unit.name})`);
        setScan("");
        return;
      }
    }
    // 3) not found
    if (confirm(`Product not found for "${code}". Add it now?`)) {
      setQuickAddBarcode(code);
      setQuickAddOpen(true);
    } else {
      toast.error("Product not found");
    }
    setScan("");
  };

  const handleCameraScan = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    const { data } = await supabase.from("products").select("*").eq("barcode", clean).eq("is_active", true).maybeSingle();
    const prod = data as Product | null;
    if (prod) { await addToCart(prod); toast.success(`Added: ${prod.name}`); return; }
    const { data: unitRow } = await supabase.from("product_units").select("*").eq("barcode", clean).maybeSingle();
    if (unitRow) {
      const unit = unitRow as unknown as ProductUnit;
      const { data: parent } = await supabase.from("products").select("*").eq("id", unit.product_id).eq("is_active", true).maybeSingle();
      if (parent) { await addToCart(parent as Product, { unit }); toast.success(`Added: ${(parent as Product).name} (${unit.name})`); return; }
    }
    if (confirm(`Product not found for "${clean}". Add it now?`)) {
      setQuickAddBarcode(clean);
      setQuickAddOpen(true);
    } else {
      toast.error(`Product not found: ${clean}`);
    }
  };


  useEffect(() => {
    if (!searchOpen) return;
    if (manualSearchTimer.current) clearTimeout(manualSearchTimer.current);
    manualSearchTimer.current = setTimeout(async () => {
      setManualLoading(true);
      const term = manualSearch.trim();
      let extraIds: string[] = [];
      if (term) {
        const { data: unitMatches } = await supabase
          .from("product_units")
          .select("product_id")
          .ilike("barcode", `%${term}%`)
          .limit(100);
        extraIds = Array.from(new Set((unitMatches ?? []).map((u: { product_id: string }) => u.product_id)));
      }
      let q = supabase.from("products").select("*").eq("is_active", true).order("name");
      if (term) {
        const idFilter = extraIds.length ? `,id.in.(${extraIds.join(",")})` : "";
        q = q.or(`name.ilike.%${term}%,barcode.ilike.%${term}%${idFilter}`);
      }
      q = q.range(0, 99);
      const { data } = await q;
      setManualResults((data ?? []) as Product[]);
      setManualLoading(false);
    }, manualSearch ? 300 : 0);

    return () => { if (manualSearchTimer.current) clearTimeout(manualSearchTimer.current); };
  }, [manualSearch, searchOpen]);

  // Warm the units cache for whatever products are on screen so clicks add to cart instantly.
  useEffect(() => { void prefetchUnits(products); }, [products, prefetchUnits]);
  useEffect(() => { void prefetchUnits(manualResults); }, [manualResults, prefetchUnits]);

  const filtered = products;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const subtotal = cart.reduce((s, i) => s + i.qty * Number(i.unit_sale_price), 0);
  // Discount must never push the bill below total cost — otherwise the sale is a loss.
  const cartCost = cart.reduce((s, i) => s + i.qty * Number(i.unit_purchase_price || 0), 0);
  const maxDiscount = Math.max(0, subtotal - cartCost);
  const cappedDiscount = Math.min(discount, maxDiscount);
  const taxAmount = Math.max(0, (subtotal - cappedDiscount) * (taxRate / 100));
  const total = Math.max(0, subtotal - cappedDiscount + taxAmount);
  const cashNum = Number(cash) || 0;
  const change = Math.max(0, cashNum - total);

  const processSale = async () => {
    if (!session) { toast.error("Start a shift first"); return; }
    if (cart.length === 0) return toast.error("Cart is empty");
    if (discount > maxDiscount) return toast.error(`Discount cannot exceed Rs. ${maxDiscount.toFixed(2)} (would sell below cost)`);
    if (paymentMethod === "cash" && cash !== "" && cashNum < total) return toast.error("Cash received is less than total");
    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc("process_sale_v2", {
        _items: cart.map(i => ({
          product_id: i.id, product_name: i.name, barcode: i.barcode,
          unit_id: i.unit_id,
          qty: i.qty,
          unit_price: i.unit_sale_price,
          purchase_price: i.unit_purchase_price,
          subtotal: i.qty * i.unit_sale_price,
        })),
        _subtotal: subtotal, _tax_amount: taxAmount, _discount: cappedDiscount, _total: total,
        _cash_received: paymentMethod === "cash" ? (cash !== "" ? cashNum : total) : total,
        _change_returned: paymentMethod === "cash" ? (cash !== "" ? change : 0) : 0,
        _payment_type: paymentMethod,
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Sale completed!");
      const result = data as any;
      setLastReceipt({
        bill_no: result.bill_no,
        items: cart.map((i) => ({ name: `${i.name}${i.unit_name && i.available_units.length > 1 ? ` (${i.unit_name})` : ""}`, barcode: i.barcode, qty: i.qty, sale_price: i.unit_sale_price })),
        subtotal, tax_amount: taxAmount,
        discount: cappedDiscount, total,
        cash_received: paymentMethod === "cash" ? (cash !== "" ? cashNum : total) : total,
        change_returned: paymentMethod === "cash" ? (cash !== "" ? change : 0) : 0,
        cashier_name: fullName, created_at: new Date().toISOString(),
      });
      // Decrement stock locally for sold items instead of re-querying the whole catalog after every sale.
      const soldBase = new Map<string, number>();
      for (const it of cart) soldBase.set(it.id, (soldBase.get(it.id) ?? 0) + it.qty * (it.unit_equals_base || 1));
      setProducts((prev) =>
        prev.map((p) => (soldBase.has(p.id) ? { ...p, stock: p.stock - (soldBase.get(p.id) ?? 0) } : p)),
      );
      setCart([]); setCash(""); setDiscount(0); setPaymentMethod("cash");
      await refreshSession();
    } finally { setProcessing(false); }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const cartItemCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Topbar ── */}
      <header className="flex items-center justify-between px-2 sm:px-4 py-2 border-b bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-sidebar-primary shrink-0">
            <Store className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs sm:text-sm leading-tight truncate">ZIC Mart POS</div>
            <div className="text-[10px] sm:text-xs opacity-70 leading-tight truncate">{fullName}</div>
          </div>
        </div>

        {/* Nav buttons — icon only on xs, icon+label on sm+ */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {session ? (
            <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3" onClick={() => setCloseOpen(true)}>
              <StopCircle className="h-4 w-4" />
              <span className="hidden sm:inline ml-1 text-xs">Close Shift</span>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3" onClick={() => setStartOpen(true)} disabled={shiftLoading}>
              <PlayCircle className="h-4 w-4" />
              <span className="hidden sm:inline ml-1 text-xs">Start Shift</span>
            </Button>
          )}
          {session && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3">
                  <Banknote className="h-4 w-4" />
                  <span className="hidden sm:inline ml-1 text-xs">Counter Cash</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 text-sm">
                <div className="font-semibold mb-2">Counter Cash</div>
                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Opening</span><span>{fmt(session.opening_cash)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Cash Sales</span><span>+{fmt(session.cash_sales)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid to Suppliers</span><span>-{fmt(session.cash_paid_out)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Expenses</span><span>-{fmt(session.expenses)}</span></div>
                  <div className="flex justify-between pt-2 mt-2 border-t font-bold"><span>In Drawer</span><span>{fmt(session.expected_cash)}</span></div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {session && (
            <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3" onClick={() => setExpenseOpen(true)}>
              <HandCoins className="h-4 w-4" />
              <span className="hidden sm:inline ml-1 text-xs">Expense</span>
            </Button>
          )}
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3">
            <Link to="/stock-entry"><Package className="h-4 w-4" /><span className="hidden sm:inline ml-1 text-xs">Stock</span></Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3">
            <Link to="/returns"><RotateCcw className="h-4 w-4" /><span className="hidden sm:inline ml-1 text-xs">Return</span></Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent">
            <Link to="/suppliers"><Truck className="h-4 w-4" /><span className="hidden sm:inline ml-1 text-xs">Suppliers</span></Link>
          </Button>
          {role === "admin" && (
            <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-3">
              <Link to="/admin/dashboard"><LayoutDashboard className="h-4 w-4" /><span className="hidden md:inline ml-1 text-xs">Admin</span></Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent h-8 px-1.5 sm:px-2" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Left / Main ── */}
        <div className="flex-1 flex flex-col p-2 sm:p-3 lg:p-4 gap-2 sm:gap-3 overflow-hidden min-w-0">

          {/* Scan bar */}
          <Card className="p-2 sm:p-3 shrink-0">
            <div className="flex gap-2">
              <form onSubmit={onScan} className="flex gap-2 flex-1 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <ScanLine className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
                  <Input
                    ref={scanRef}
                    className="pl-8 sm:pl-10 h-9 sm:h-11 text-sm sm:text-base w-full"
                    placeholder="Scan barcode…"
                    value={scan}
                    onChange={e => setScan(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </form>
              <Button type="button" variant="outline" className="h-9 sm:h-11 px-2 sm:px-3 shrink-0" onClick={() => setCameraOpen(true)} title="Scan with camera">
                <Camera className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 sm:mt-3">
              <Button className="h-9 sm:h-11 text-sm sm:text-base font-semibold" onClick={() => setSearchOpen(true)}>
                <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2" /> Search
              </Button>
              <Button variant="outline" className="h-9 sm:h-11 text-sm sm:text-base font-semibold" onClick={() => { setQuickAddBarcode(""); setQuickAddOpen(true); }}>
                <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2" /> New Product
              </Button>
            </div>
          </Card>


          {/* Cart table */}
          <Card className="flex-1 overflow-hidden p-0 min-h-0">
            <div className="h-full flex flex-col overflow-hidden">
              {cart.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <ShoppingCart className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-base sm:text-lg text-muted-foreground">Cart is empty</p>
                  <p className="text-xs sm:text-sm text-muted-foreground">Scan items to add to cart</p>
                </div>
              ) : (
                <div className="overflow-auto flex-1">
                  {/* Table header */}
                  <div className="sticky top-0 bg-muted/50 backdrop-blur border-b z-10">
                    <div className="grid gap-1 px-2 sm:px-4 py-2 text-xs font-bold text-muted-foreground"
                      style={{ gridTemplateColumns: "1fr 5rem 6rem 4rem 2rem" }}>
                      <div>Product</div>
                      <div className="text-right hidden sm:block">Unit / Price</div>
                      <div className="text-center">Qty</div>
                      <div className="text-right">Total</div>
                      <div />
                    </div>
                  </div>

                  {/* Rows */}
                  <div className="divide-y">
                    {cart.map((i, idx) => (
                      <CartItemRow
                        key={`${i.id}-${i.unit_id ?? "base"}-${idx}`}
                        i={i}
                        idx={idx}
                        onUpdate={updateCartItem}
                        onRemove={removeCartItem}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Right sidebar (desktop) ── */}
        <div className="hidden lg:flex w-80 xl:w-96 2xl:w-[440px] flex-col bg-sidebar border-l shrink-0">
          <BillSummary
            cart={cart} subtotal={subtotal} discount={cappedDiscount} setDiscount={setDiscount}
            maxDiscount={maxDiscount}
            taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
            processing={processing} processSale={processSale}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            discountOpen={discountOpen} setDiscountOpen={setDiscountOpen}
            discountInput={discountInput} setDiscountInput={setDiscountInput}
          />
        </div>

        {/* ── Mobile floating pay button ── */}
        <button
          onClick={() => setCartOpen(true)}
          className="lg:hidden fixed bottom-4 right-4 z-40 h-14 px-4 sm:px-6 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 flex items-center gap-2 font-bold text-sm sm:text-base hover:shadow-xl transition-all"
        >
          <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 shrink-0" />
          <span>Pay</span>
          {cartItemCount > 0 && (
            <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs font-bold">{cartItemCount}</span>
          )}
        </button>

        {/* ── Mobile bill sheet ── */}
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetContent side="right" className="w-full sm:max-w-sm p-0 flex flex-col h-full">
            <SheetHeader className="px-4 py-3 border-b shrink-0">
              <SheetTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-5 w-5" /> Bill Summary
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-hidden min-h-0">
              <BillSummary
                cart={cart} subtotal={subtotal} discount={cappedDiscount} setDiscount={setDiscount}
                maxDiscount={maxDiscount}
                taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
                processing={processing}
                processSale={async () => { await processSale(); setCartOpen(false); }}
                paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                discountOpen={discountOpen} setDiscountOpen={setDiscountOpen}
                discountInput={discountInput} setDiscountInput={setDiscountInput}
                hideHeader
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* ── No active shift overlay ── */}
        {!shiftLoading && !session && (
          <div className="absolute inset-0 z-30 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
            <Card className="p-6 max-w-sm w-full text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <PlayCircle className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="font-semibold text-lg">No Active Shift</div>
                <p className="text-sm text-muted-foreground mt-1">Start a shift to begin selling.</p>
              </div>
              <Button className="w-full" onClick={() => setStartOpen(true)}>Start Shift</Button>
            </Card>
          </div>
        )}
      </div>

      {/* ── Product Search Sheet (bottom) ── */}
      <Sheet open={searchOpen} onOpenChange={val => { setSearchOpen(val); if (!val) { setManualSearch(""); setManualResults([]); } }}>
        <SheetContent side="bottom" className="w-full h-[90dvh] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm sm:text-base">
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" /> Manual Product Search
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="p-3 sm:p-4 border-b shrink-0 space-y-2">
              <Input placeholder="Search products..." value={manualSearch} onChange={e => setManualSearch(e.target.value)} className="h-9 sm:h-10" autoFocus />
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <Button size="sm" variant={cat === "all" ? "default" : "outline"} className="shrink-0 text-xs h-7 px-2.5" onClick={() => setCat("all")}>All</Button>
                {cats.map(c => (
                  <Button key={c.id} size="sm" variant={cat === c.id ? "default" : "outline"} className="shrink-0 text-xs h-7 px-2.5" onClick={() => setCat(c.id)}>{c.name}</Button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-2 sm:p-3">
              {manualLoading ? (
                <div className="text-center text-muted-foreground py-12 text-sm">Searching…</div>
              ) : manualResults.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">
                  {manualSearch ? "No products found." : "Start typing to search."}
                </div>
              ) : (
                <div className="grid grid-cols-2 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                  {manualResults.map(p => (
                    <button key={p.id}
                      onClick={() => { addToCart(p); setSearchOpen(false); setManualSearch(""); setManualResults([]); }}
                      className="text-left p-2 sm:p-3 rounded-xl border bg-card hover:border-primary hover:shadow-lg transition-all flex flex-col">
                      <div className="font-semibold text-xs sm:text-sm line-clamp-2 flex-1">{p.name}</div>
                      <div className="mt-1.5 sm:mt-2 flex items-center justify-between gap-1">
                        <span className="font-bold text-primary text-xs sm:text-sm">{fmt(p.sale_price)}</span>
                        <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full shrink-0 ${p.stock === 0 ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}>
                          {(() => {
                            const pu = unitsCache.current[p.id] ?? [];
                            const bu = pu.find(u => u.is_base);
                            return bu ? `${p.stock} ${bu.name}` : p.stock;
                          })()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex flex-col xs:flex-row items-center justify-between gap-2 pt-4 border-t mt-4">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} / {totalPages} &nbsp;·&nbsp; {totalCount.toLocaleString()} products
                  </span>
                  <div className="flex gap-2">
                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                      className="px-3 py-1 text-xs sm:text-sm rounded border bg-card hover:bg-muted disabled:opacity-40">← Prev</button>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                      className="px-3 py-1 text-xs sm:text-sm rounded border bg-card hover:bg-muted disabled:opacity-40">Next →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {lastReceipt && <Receipt sale={lastReceipt} onClose={() => setLastReceipt(null)} />}
      <BarcodeScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={handleCameraScan} />
      <StartShiftDialog open={startOpen} onOpenChange={setStartOpen} onStarted={s => setSession(s)} />
      <CloseShiftDialog open={closeOpen} onOpenChange={setCloseOpen} session={session}
        onClosed={() => { setSession(null); setCart([]); setCash(""); setDiscount(0); }} />
      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} onRecorded={() => refreshSession()} />
      <QuickAddProductDialog
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        initialBarcode={quickAddBarcode}
        onCreated={(p) => { addToCart(p as Product); toast.success(`Added: ${p.name}`); }}
      />
    </div>
  );
}

/* ─────────────────────────── BillSummary ─────────────────────────── */

interface CartPanelProps {
  cart: CartItem[];
  subtotal: number; discount: number; setDiscount: (n: number) => void;
  maxDiscount: number;
  taxRate: number; taxAmount: number; total: number;
  cash: string; setCash: (s: string) => void; change: number;
  processing: boolean; processSale: () => unknown | Promise<unknown>;
  paymentMethod: PaymentMethod; setPaymentMethod: (m: PaymentMethod) => void;
  discountOpen: boolean; setDiscountOpen: (o: boolean) => void;
  discountInput: string; setDiscountInput: (v: string) => void;
  hideHeader?: boolean;
}

function BillSummary({
  cart, subtotal, discount, setDiscount, maxDiscount, taxRate, taxAmount, total,
  cash, setCash, change, processing, processSale,
  paymentMethod, setPaymentMethod,
  discountOpen, setDiscountOpen, discountInput, setDiscountInput,
  hideHeader,
}: CartPanelProps) {
  const cardSurcharge = paymentMethod === "card" ? Math.round(subtotal * 0.02 * 100) / 100 : 0;
  const finalTotal = total + cardSurcharge;

  const applyDiscount = () => {
    const want = Math.max(0, Number(discountInput) || 0);
    if (want > maxDiscount) {
      toast.error(`Discount cannot exceed Rs. ${maxDiscount.toFixed(2)} (cart cost limit)`);
      setDiscount(maxDiscount);
      setDiscountInput(String(maxDiscount));
    } else {
      setDiscount(want);
    }
    setDiscountOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-hidden">
      {!hideHeader && (
        <div className="px-4 py-3 border-b shrink-0 border-sidebar-accent/30">
          <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
            <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5" /> Bill Summary
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col justify-between min-h-0 p-3 gap-2 sm:gap-3 overflow-y-auto">

        {/* Summary rows */}
        <div className="space-y-1.5 bg-sidebar-accent/30 px-3 py-2.5 rounded-lg shrink-0">
          <Row label="Items:" value={cart.reduce((s, i) => s + i.qty, 0).toString()} />
          <Row label="Subtotal:" value={fmt(subtotal)} />
          {discount > 0 && (
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span className="text-orange-400/80">Discount:</span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-orange-400">- {fmt(discount)}</span>
                <button
                  onClick={() => { setDiscount(0); setDiscountInput(""); }}
                  className="h-4 w-4 rounded-full bg-orange-500/20 hover:bg-orange-500/40 flex items-center justify-center transition-colors"
                  title="Remove discount"
                >
                  <X className="h-2.5 w-2.5 text-orange-400" />
                </button>
              </div>
            </div>
          )}
          {taxRate > 0 && <Row label={`Tax (${taxRate}%):`} value={fmt(taxAmount)} />}
          {cardSurcharge > 0 && <Row label="Card Surcharge (2%):" value={fmt(cardSurcharge)} />}
          <div className="flex items-center justify-between pt-2 border-t border-sidebar-accent/30">
            <span className="font-bold text-xs sm:text-sm">Net Total:</span>
            <span className="text-lg sm:text-xl font-bold text-green-500">{fmt(finalTotal)}</span>
          </div>
        </div>

        {/* Cash received */}
        {paymentMethod === "cash" && (
          <div className="space-y-1.5 bg-sidebar-accent/20 px-3 py-2.5 rounded-lg shrink-0">
            <label className="text-xs font-semibold text-sidebar-foreground/80">
              Cash Received (Rs.) <span className="font-normal opacity-60">optional</span>
            </label>
            <Input
              type="number"
              className="h-8 sm:h-9 w-full text-right text-sm sm:text-base font-bold"
              value={cash}
              onChange={e => setCash(e.target.value)}
              placeholder="0.00"
            />
            <div className="flex items-center justify-between pt-1.5 border-t border-sidebar-accent/30">
              <span className="text-xs font-semibold text-sidebar-foreground/80">Change</span>
              <span className="text-sm sm:text-base font-bold text-green-500">{fmt(change)}</span>
            </div>
          </div>
        )}

        {/* Payment method grid */}
        <div className="grid grid-cols-2 gap-1.5 sm:gap-2 shrink-0">
          {(
            [
              { id: "cash",      label: "Cash",      icon: <Banknote className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, active: "bg-primary border-primary text-white",                  idle: "bg-white border-gray-300 text-gray-800 hover:bg-gray-100" },
              { id: "card",      label: "Card +2%",  icon: <CreditCard className="h-3.5 w-3.5 sm:h-4 sm:w-4" />, active: "bg-blue-600 border-blue-600 text-white",            idle: "bg-white border-blue-500 text-blue-600 hover:bg-blue-50" },
              { id: "easypasa",  label: "EasyPaisa", icon: <span className="text-xs sm:text-sm">💳</span>,       active: "bg-green-600 border-green-600 text-white",           idle: "bg-white border-green-500 text-green-700 hover:bg-green-50" },
              { id: "jazzcash",  label: "JazzCash",  icon: <span className="text-xs sm:text-sm">💳</span>,       active: "bg-red-600 border-red-600 text-white",               idle: "bg-white border-red-500 text-red-600 hover:bg-red-50" },
            ] as const
          ).map(btn => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setPaymentMethod(btn.id)}
              className={`flex items-center justify-center gap-1 text-xs sm:text-sm h-9 sm:h-10 rounded-md font-medium border-2 transition-colors ${paymentMethod === btn.id ? btn.active : btn.idle}`}
            >
              {btn.icon} {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom actions — pinned */}
      <div className="px-3 pb-3 pt-2 border-t border-sidebar-accent/30 space-y-1.5 sm:space-y-2 shrink-0">
        <Button
          disabled={processing || cart.length === 0}
          onClick={processSale}
          className="w-full h-10 sm:h-11 text-sm sm:text-base font-semibold"
        >
          {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Process Sale
        </Button>

        <Popover open={discountOpen} onOpenChange={o => {
          setDiscountOpen(o);
          if (o) setDiscountInput(discount > 0 ? String(discount) : "");
        }}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`w-full text-xs font-semibold h-7 sm:h-8 gap-1.5 ${discount > 0 ? "border-orange-500/60 text-orange-400 bg-orange-500/10" : ""}`}
            >
              <Tag className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {discount > 0 ? `Discount: ${fmt(discount)}` : "Add Discount"}
              <kbd className="ml-auto text-[10px] opacity-50 font-mono bg-muted px-1 rounded">F10</kbd>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-56 sm:w-64 p-3 space-y-3">
            <div className="text-xs sm:text-sm font-semibold flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-orange-400" /> Discount Amount (Rs.)
            </div>
            <Input
              type="number" min={0} autoFocus
              className="h-9 sm:h-10 text-right text-base sm:text-lg font-bold"
              placeholder="0.00"
              value={discountInput}
              onChange={e => setDiscountInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") applyDiscount();
                if (e.key === "Escape") setDiscountOpen(false);
              }}
            />
            {subtotal > 0 && Number(discountInput) > 0 && (
              <p className={`text-xs text-right -mt-1 ${Number(discountInput) > maxDiscount ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                = {((Number(discountInput) / subtotal) * 100).toFixed(1)}% off
                {Number(discountInput) > maxDiscount && ` · exceeds max ${fmt(maxDiscount)}`}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground text-right">
              Max discount: <span className="font-semibold">{fmt(maxDiscount)}</span> (cart cost {fmt(subtotal - maxDiscount)})
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 text-xs sm:text-sm" onClick={applyDiscount}>Apply</Button>
              {discount > 0 && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive px-2"
                  onClick={() => { setDiscount(0); setDiscountInput(""); setDiscountOpen(false); }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}



function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs sm:text-sm">
      <span className="text-sidebar-foreground/80">{label}</span>
      <span className={bold ? "font-bold text-sm sm:text-base text-sidebar-foreground" : "font-semibold text-sidebar-foreground"}>{value}</span>
    </div>
  );
}