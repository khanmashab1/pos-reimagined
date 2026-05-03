import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Minus, Trash2, ScanLine, ShoppingCart, X, Store, LogOut, LayoutDashboard, Camera, PlayCircle, StopCircle, CreditCard, Banknote } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import { Receipt } from "@/components/Receipt";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { StartShiftDialog, CloseShiftDialog, type OpenSession } from "@/components/ShiftDialog";

export const Route = createFileRoute("/pos")({
  component: PosPage,
});

interface Product {
  id: string; barcode: string; name: string; sale_price: number; purchase_price: number; stock: number; category_id: string | null;
}
interface CartItem extends Product { qty: number; }

function PosPage() {
  const { loading, user, role, signOut, fullName } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [cash, setCash] = useState<string>("");
  const [taxRate, setTaxRate] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [session, setSession] = useState<OpenSession | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const isMobile = useIsMobile();
  const scanRef = useRef<HTMLInputElement>(null);

  const refreshSession = useCallback(async () => {
    const { data } = await supabase.rpc("get_open_session");
    setSession((data as unknown as OpenSession) ?? null);
    setShiftLoading(false);
  }, []);

  useEffect(() => { if (user) refreshSession(); }, [user, refreshSession]);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: c }, { data: s }] = await Promise.all([
        supabase.from("products").select("*").eq("is_active", true).order("name"),
        supabase.from("categories").select("id,name").order("name"),
        supabase.from("store_settings").select("tax_rate").eq("id", 1).single(),
      ]);
      setProducts((p ?? []) as Product[]);
      setCats(c ?? []);
      setTaxRate(Number(s?.tax_rate ?? 0));
    })();
  }, []);

  useEffect(() => { scanRef.current?.focus(); }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); processSale(); }
      if (e.key === "F4") { e.preventDefault(); if (confirm("Clear cart?")) setCart([]); }
      if (e.key === "Escape") scanRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addToCart = (p: Product) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === p.id);
      if (ex) {
        if (ex.qty + 1 > p.stock) { toast.error("Insufficient stock"); return prev; }
        return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      }
      if (p.stock < 1) { toast.error("Out of stock"); return prev; }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const onScan = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    const prod = products.find(p => p.barcode === code);
    if (prod) { addToCart(prod); toast.success(`Added: ${prod.name}`); }
    else toast.error("Product not found");
    setScan("");
  };

  const onCameraScan = useCallback((code: string) => {
    const prod = products.find(p => p.barcode === code);
    if (prod) { addToCart(prod); toast.success(`Scanned: ${prod.name}`); }
    else toast.error(`Product not found: ${code}`);
  }, [products]);

  const filtered = useMemo(() => products.filter(p => {
    if (cat !== "all" && p.category_id !== cat) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.barcode.includes(search)) return false;
    return true;
  }), [products, search, cat]);

  const subtotal = cart.reduce((s, i) => s + i.qty * Number(i.sale_price), 0);
  const taxAmount = Math.max(0, (subtotal - discount) * (taxRate / 100));
  const total = Math.max(0, subtotal - discount + taxAmount);
  const cashNum = Number(cash) || 0;
  const change = Math.max(0, cashNum - total);

  const processSale = async () => {
    if (!session) return toast.error("Start a shift first");
    if (cart.length === 0) return toast.error("Cart is empty");
    if (paymentMethod === "cash" && cashNum < total) return toast.error("Cash received is less than total");
    setProcessing(true);
    const { data, error } = await supabase.rpc("process_sale", {
      _items: cart.map(i => ({
        product_id: i.id, product_name: i.name, barcode: i.barcode,
        qty: i.qty, unit_price: i.sale_price, purchase_price: i.purchase_price,
        subtotal: i.qty * i.sale_price,
      })),
      _subtotal: subtotal, _tax_amount: taxAmount, _discount: discount,
      _total: total,
      _cash_received: paymentMethod === "cash" ? cashNum : total,
      _change_returned: paymentMethod === "cash" ? change : 0,
      _payment_type: paymentMethod,
    });
    setProcessing(false);
    if (error) return toast.error(error.message);
    toast.success("Sale completed!");
    const result = data as any;
    setLastReceipt({
      bill_no: result.bill_no, items: cart, subtotal, tax_amount: taxAmount,
      discount, total,
      cash_received: paymentMethod === "cash" ? cashNum : total,
      change_returned: paymentMethod === "cash" ? change : 0,
      cashier_name: fullName, created_at: new Date().toISOString(),
    });
    setCart([]); setCash(""); setDiscount(0);
    // refresh stock + session totals
    const { data: p } = await supabase.from("products").select("*").eq("is_active", true).order("name");
    setProducts((p ?? []) as Product[]);
    refreshSession();
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Topbar */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <Store className="h-4 w-4" />
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">ZIC Mart POS</div>
            <div className="text-xs opacity-70 leading-tight">{fullName}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session ? (
            <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setCloseOpen(true)}>
              <StopCircle className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Close Shift</span>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={() => setStartOpen(true)} disabled={shiftLoading}>
              <PlayCircle className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Start Shift</span>
            </Button>
          )}
          {role === "admin" && (
            <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent">
              <Link to="/admin/dashboard"><LayoutDashboard className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Admin</span></Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Left: scan + products */}
        <div className="flex-1 flex flex-col p-3 sm:p-4 gap-3 overflow-hidden">
          <Card className="p-3">
            <form onSubmit={onScan} className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                <Input ref={scanRef} className="pl-10 h-11 text-base" placeholder="Scan barcode…"
                  value={scan} onChange={e => setScan(e.target.value)} />
              </div>
              <Button type="button" variant="outline" className="h-11 px-3" onClick={() => setCameraOpen(true)} title="Scan with camera">
                <Camera className="h-5 w-5" />
              </Button>
            </form>
            <div className="mt-2 flex gap-2">
              <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
              <Button size="sm" variant={cat === "all" ? "default" : "outline"} onClick={() => setCat("all")}>All</Button>
              {cats.map(c => (
                <Button key={c.id} size="sm" variant={cat === c.id ? "default" : "outline"} onClick={() => setCat(c.id)}>{c.name}</Button>
              ))}
            </div>
          </Card>

          <div className="flex-1 overflow-auto pb-20 lg:pb-0">
            {filtered.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">No products available.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filtered.map(p => (
                  <button key={p.id} onClick={() => addToCart(p)}
                    disabled={p.stock < 1}
                    className="text-left p-3 rounded-xl border bg-card hover:border-primary hover:shadow-[var(--shadow-card)] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    <div className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">{p.name}</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-bold text-primary">{fmt(p.sale_price)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${p.stock === 0 ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}>{p.stock}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: cart — desktop sidebar */}
        <div className="hidden lg:flex w-full max-w-md flex-col bg-card border-l">
          <CartPanel
            cart={cart} setCart={setCart} subtotal={subtotal} discount={discount} setDiscount={setDiscount}
            taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
            processing={processing} processSale={processSale}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
          />
        </div>

        {/* Mobile floating cart button */}
        {isMobile && (
          <button
            onClick={() => setCartOpen(true)}
            className="lg:hidden fixed bottom-4 right-4 z-40 h-14 px-5 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-2 font-semibold"
          >
            <ShoppingCart className="h-5 w-5" />
            <span>{cart.reduce((s, i) => s + i.qty, 0)} • {fmt(total)}</span>
          </button>
        )}

        {/* Mobile cart sheet */}
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Current Sale</SheetTitle>
            </SheetHeader>
            <CartPanel
              cart={cart} setCart={setCart} subtotal={subtotal} discount={discount} setDiscount={setDiscount}
              taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
              processing={processing} processSale={async () => { await processSale(); setCartOpen(false); }}
              paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
              hideHeader
            />
          </SheetContent>
        </Sheet>

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

      {lastReceipt && <Receipt sale={lastReceipt} onClose={() => setLastReceipt(null)} />}
      <BarcodeScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onScan={onCameraScan} />
      <StartShiftDialog open={startOpen} onOpenChange={setStartOpen} onStarted={s => setSession(s)} />
      <CloseShiftDialog open={closeOpen} onOpenChange={setCloseOpen} session={session}
        onClosed={() => { setSession(null); setCart([]); setCash(""); setDiscount(0); }} />
    </div>
  );
}

interface CartPanelProps {
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  subtotal: number; discount: number; setDiscount: (n: number) => void;
  taxRate: number; taxAmount: number; total: number;
  cash: string; setCash: (s: string) => void; change: number;
  processing: boolean; processSale: () => unknown | Promise<unknown>;
  paymentMethod: "cash" | "card"; setPaymentMethod: (m: "cash" | "card") => void;
  hideHeader?: boolean;
}

function CartPanel({ cart, setCart, subtotal, discount, setDiscount, taxRate, taxAmount, total, cash, setCash, change, processing, processSale, paymentMethod, setPaymentMethod, hideHeader }: CartPanelProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!hideHeader && (
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-4 w-4" /> Current Sale</div>
          <span className="text-xs text-muted-foreground">{cart.reduce((s, i) => s + i.qty, 0)} items</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {cart.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cart is empty.<br/>Scan or click a product to start.</div>
        ) : (
          <div className="divide-y">
            {cart.map(i => (
              <div key={i.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{i.name}</div>
                    <div className="text-xs text-muted-foreground">{fmt(i.sale_price)} ea</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                    onClick={() => setCart(cart.filter(c => c.id !== i.id))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Button size="icon" variant="outline" className="h-8 w-8"
                      onClick={() => setCart(cart.map(c => c.id === i.id ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}><Minus className="h-3 w-3" /></Button>
                    <span className="w-8 text-center text-sm font-medium">{i.qty}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8"
                      onClick={() => {
                        if (i.qty + 1 > i.stock) return toast.error("Stock limit");
                        setCart(cart.map(c => c.id === i.id ? { ...c, qty: c.qty + 1 } : c));
                      }}><Plus className="h-3 w-3" /></Button>
                  </div>
                  <div className="font-semibold">{fmt(i.qty * Number(i.sale_price))}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 border-t space-y-2.5 bg-muted/30">
        <Row label="Subtotal" value={fmt(subtotal)} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Discount</span>
          <Input type="number" className="h-7 w-24 text-right" value={discount}
            onChange={e => setDiscount(Math.max(0, +e.target.value))} />
        </div>
        {taxRate > 0 && <Row label={`Tax (${taxRate}%)`} value={fmt(taxAmount)} />}
        <div className="flex items-center justify-between pt-2 border-t">
          <span className="font-bold">TOTAL</span>
          <span className="text-2xl font-bold text-primary">{fmt(total)}</span>
        </div>

        <div className="pt-2 grid grid-cols-2 gap-2">
          <Button type="button" variant={paymentMethod === "cash" ? "default" : "outline"} size="sm" onClick={() => setPaymentMethod("cash")}>
            <Banknote className="h-4 w-4 mr-1" /> Cash
          </Button>
          <Button type="button" variant={paymentMethod === "card" ? "default" : "outline"} size="sm" onClick={() => setPaymentMethod("card")}>
            <CreditCard className="h-4 w-4 mr-1" /> Card
          </Button>
        </div>

        {paymentMethod === "cash" && (
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Cash Received</span>
              <Input type="number" className="h-9 w-32 text-right text-base font-semibold" value={cash}
                onChange={e => setCash(e.target.value)} placeholder="0" />
            </div>
            <Row label="Change" value={fmt(change)} bold />
          </div>
        )}

        <div className="pt-2 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => { if (confirm("Clear cart?")) { setCart([]); setCash(""); setDiscount(0); } }}>
            <Trash2 className="h-4 w-4 mr-1" /> Clear
          </Button>
          <Button disabled={processing || cart.length === 0} onClick={processSale}>
            {processing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Pay
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold text-base" : "font-medium"}>{value}</span>
    </div>
  );
}
