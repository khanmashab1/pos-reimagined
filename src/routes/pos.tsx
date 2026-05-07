import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Minus, Trash2, ScanLine, ShoppingCart, X, Store, LogOut, LayoutDashboard, Camera, PlayCircle, StopCircle, CreditCard, Banknote, RotateCcw, Package, Tag } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [session, setSession] = useState<OpenSession | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
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

  // load categories + tax once
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

  // load products page (server-side search + category filter)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let q = supabase
          .from("products")
          .select("*", { count: "exact" })
          .eq("is_active", true)
          .order("name")
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (cat !== "all") q = q.eq("category_id", cat);
        if (search) q = q.or(`name.ilike.%${search}%,barcode.ilike.%${search}%`);
        const { data: p, count, error } = await q;
        
        if (error) {
          console.error("Error fetching products:", error);
          return;
        }
        
        if (!cancelled) {
          setProducts((p ?? []) as Product[]);
          setTotalCount(count ?? 0);
        }
      } catch (err) {
        console.error("Products fetch error:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [page, search, cat]);

  // reset to page 0 when search or category changes
  useEffect(() => { setPage(0); }, [search, cat]);

  useEffect(() => { scanRef.current?.focus(); }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); processSale(); }
      if (e.key === "F4") { e.preventDefault(); if (confirm("Clear cart?")) setCart([]); }
      if (e.key === "F10") {
        e.preventDefault();
        setDiscountInput(discount > 0 ? String(discount) : "");
        setDiscountOpen(prev => !prev);
      }
      if (e.key === "Escape") { setDiscountOpen(false); scanRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addToCart = (p: Product) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === p.id);
      if (ex) {
        return prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...p, qty: 1 }];
    });
  };

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim().replace(/[\s\-]/g, '');
    if (!code) return;
    // check current page first for speed, then fall back to DB lookup
    let prod: Product | undefined = products.find(p => p.barcode === code);
    if (!prod) {
      const { data } = await supabase.from("products").select("*").eq("barcode", code).eq("is_active", true).maybeSingle();
      prod = (data as Product) ?? undefined;
    }
    if (prod) { addToCart(prod); toast.success(`Added: ${prod.name}`); }
    else toast.error("Product not found");
    setScan("");
  };

  const onCameraScan = useCallback(async (code: string) => {
    try {
      // Normalize barcode: trim, remove special chars, keep only alphanumeric
      const cleanCode = code.trim().replace(/[\s\-]/g, '');
      console.log("Scanned barcode:", { raw: code, cleaned: cleanCode });
      
      let prod: Product | undefined = products.find(p => p.barcode === cleanCode);
      if (!prod) {
        // Try exact match first
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("barcode", cleanCode)
          .eq("is_active", true)
          .maybeSingle();
        
        if (error) {
          console.error("Database error:", error);
          toast.error(`Error scanning product: ${error.message}`);
          return;
        }
        
        prod = (data as Product) ?? undefined;
        
        // If not found, try case-insensitive search
        if (!prod) {
          const { data: fuzzyData, error: fuzzyError } = await supabase
            .from("products")
            .select("*")
            .ilike("barcode", cleanCode)
            .eq("is_active", true)
            .maybeSingle();
          
          if (!fuzzyError) {
            prod = (fuzzyData as Product) ?? undefined;
          }
        }
      }
      
      if (prod) { 
        addToCart(prod); 
        toast.success(`Scanned: ${prod.name}`); 
      }
      else {
        console.warn("Product not found:", cleanCode);
        toast.error(`Product not found: ${cleanCode}`);
      }
    } catch (error) {
      console.error("Camera scan error:", error);
      toast.error(`Error scanning: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [products]);

  // filtering is done server-side; products already contains the right page
  const filtered = products;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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
    try {
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
      
      if (error) {
        toast.error(error.message);
        return;
      }
      
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
      try {
        let q = supabase
          .from("products")
          .select("*", { count: "exact" })
          .eq("is_active", true)
          .order("name")
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        if (cat !== "all") q = q.eq("category_id", cat);
        if (search) q = q.or(`name.ilike.%${search}%,barcode.ilike.%${search}%`);
        const { data: p, count, error: fetchError } = await q;
        
        if (fetchError) {
          console.error("Error refetching products:", fetchError);
        } else {
          setProducts((p ?? []) as Product[]);
          setTotalCount(count ?? 0);
        }
      } catch (refetchErr) {
        console.error("Refetch error:", refetchErr);
      }
      
      await refreshSession();
    } finally {
      setProcessing(false);
    }
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
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent">
            <Link to="/stock-entry"><Package className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Stock</span></Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent">
            <Link to="/returns"><RotateCcw className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Return</span></Link>
          </Button>
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
        {/* Left: cart table */}
        <div className="flex-1 flex flex-col p-3 sm:p-4 gap-3 overflow-hidden bg-background">
          <Card className="p-4 flex-shrink-0">
            <div className="flex gap-2">
              <form onSubmit={onScan} className="flex gap-2 flex-1">
                <div className="relative flex-1">
                  <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-primary" />
                  <Input ref={scanRef} className="pl-10 h-11 text-base" placeholder="Scan barcode or enter manually…"
                    value={scan} onChange={e => setScan(e.target.value)} />
                </div>
              </form>
              <Button type="button" variant="outline" className="h-11 px-3" onClick={() => setCameraOpen(true)} title="Scan with camera">
                <Camera className="h-5 w-5" />
              </Button>
            </div>
            <Button className="w-full mt-3 h-11 text-base font-semibold" onClick={() => setSearchOpen(true)}>
              <Plus className="h-5 w-5 mr-2" /> Manual Product Search
            </Button>
          </Card>

          <Card className="flex-1 overflow-hidden p-0">
            <div className="h-full flex flex-col overflow-hidden">
              {cart.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <ShoppingCart className="h-16 w-16 text-muted-foreground/30 mb-3" />
                  <div className="text-muted-foreground">
                    <p className="font-medium text-lg">Cart is empty</p>
                    <p className="text-sm">Scan items to add to cart</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-auto flex-1">
                  <div className="border-b sticky top-0 bg-muted/50 backdrop-blur">
                    <div className="grid grid-cols-12 gap-2 px-4 py-3 text-sm font-bold text-muted-foreground">
                      <div className="col-span-5">Product Name</div>
                      <div className="col-span-2 text-right">Price</div>
                      <div className="col-span-2 text-right">Qty</div>
                      <div className="col-span-3 text-right">Total</div>
                    </div>
                  </div>
                  <div className="divide-y">
                    {cart.map(i => (
                      <div key={i.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-muted/30 transition-colors group">
                        <div className="col-span-5">
                          <div className="font-medium text-sm truncate">{i.name}</div>
                        </div>
                        <div className="col-span-2 text-right text-sm">{fmt(i.sale_price)}</div>
                        <div className="col-span-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0"
                              onClick={() => setCart(cart.map(c => c.id === i.id ? { ...c, qty: Math.max(1, c.qty - 1) } : c))}><Minus className="h-3 w-3" /></Button>
                            <input
                              type="number"
                              min={1}
                              className="w-10 text-center text-sm font-semibold bg-transparent border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              value={i.qty}
                              onChange={e => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val >= 1) setCart(cart.map(c => c.id === i.id ? { ...c, qty: val } : c));
                              }}
                              onBlur={e => {
                                const val = parseInt(e.target.value, 10);
                                if (isNaN(val) || val < 1) setCart(cart.map(c => c.id === i.id ? { ...c, qty: 1 } : c));
                              }}
                            />
                            <Button size="icon" variant="ghost" className="h-6 w-6 flex-shrink-0"
                              onClick={() => setCart(cart.map(c => c.id === i.id ? { ...c, qty: c.qty + 1 } : c))}><Plus className="h-3 w-3" /></Button>
                          </div>
                        </div>
                        <div className="col-span-2 text-right font-semibold">{fmt(i.qty * Number(i.sale_price))}</div>
                        <div className="col-span-1 text-right">
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => setCart(cart.filter(c => c.id !== i.id))}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right: bill summary sidebar */}
        <div className="hidden lg:flex w-full lg:w-80 xl:w-96 2xl:w-[450px] flex-col bg-sidebar border-l">
          <BillSummary
            cart={cart} subtotal={subtotal} discount={discount} setDiscount={setDiscount}
            taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
            processing={processing} processSale={processSale}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            discountOpen={discountOpen} setDiscountOpen={setDiscountOpen}
            discountInput={discountInput} setDiscountInput={setDiscountInput}
          />
        </div>

        {/* Mobile floating cart button */}
        {isMobile && (
          <button
            onClick={() => setCartOpen(true)}
            className="lg:hidden fixed bottom-4 right-4 z-40 h-16 px-6 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 flex items-center gap-3 font-bold text-base hover:shadow-xl hover:shadow-primary/60 transition-all"
          >
            <CreditCard className="h-6 w-6" />
            <span>Proceed to Payment</span>
          </button>
        )}

        {/* Mobile bill summary sheet */}
        <Sheet open={cartOpen} onOpenChange={setCartOpen}>
          <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col h-full">
            <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
              <SheetTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-5 w-5" /> Bill Summary</SheetTitle>
            </SheetHeader>
            <BillSummary
              cart={cart} subtotal={subtotal} discount={discount} setDiscount={setDiscount}
              taxRate={taxRate} taxAmount={taxAmount} total={total} cash={cash} setCash={setCash} change={change}
              processing={processing} processSale={async () => { await processSale(); setCartOpen(false); }}
              paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
              discountOpen={discountOpen} setDiscountOpen={setDiscountOpen}
              discountInput={discountInput} setDiscountInput={setDiscountInput}
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

      {/* Product Search Modal */}
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent side="bottom" className="w-full h-[90vh] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> Manual Product Search
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b flex-shrink-0 space-y-2">
              <Input placeholder="Search products..." value={search} onChange={e => setSearch(e.target.value)} className="h-10" />
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <Button size="sm" variant={cat === "all" ? "default" : "outline"} onClick={() => setCat("all")}>All</Button>
                {cats.map(c => (
                  <Button key={c.id} size="sm" variant={cat === c.id ? "default" : "outline"} onClick={() => setCat(c.id)}>{c.name}</Button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">No products found.</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {filtered.map(p => (
                    <button key={p.id} onClick={() => { addToCart(p); setSearchOpen(false); }}
                      className="text-left p-3 rounded-xl border bg-card hover:border-primary hover:shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex flex-col">
                      <div className="font-semibold text-sm line-clamp-2 flex-1">{p.name}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-bold text-primary">{fmt(p.sale_price)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${p.stock === 0 ? "bg-destructive text-destructive-foreground" : "bg-muted"}`}>{p.stock}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <span className="text-xs text-muted-foreground">Page {page + 1} / {totalPages} &nbsp;&bull;&nbsp; {totalCount.toLocaleString()} products</span>
                  <div className="flex gap-2">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage(p => p - 1)}
                      className="px-3 py-1 text-sm rounded border bg-card hover:bg-muted disabled:opacity-40"
                    >← Prev</button>
                    <button
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(p => p + 1)}
                      className="px-3 py-1 text-sm rounded border bg-card hover:bg-muted disabled:opacity-40"
                    >Next →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
  subtotal: number; discount: number; setDiscount: (n: number) => void;
  taxRate: number; taxAmount: number; total: number;
  cash: string; setCash: (s: string) => void; change: number;
  processing: boolean; processSale: () => unknown | Promise<unknown>;
  paymentMethod: "cash" | "card"; setPaymentMethod: (m: "cash" | "card") => void;
  discountOpen: boolean; setDiscountOpen: (o: boolean) => void;
  discountInput: string; setDiscountInput: (v: string) => void;
  hideHeader?: boolean;
}

function BillSummary({ cart, subtotal, discount, setDiscount, taxRate, taxAmount, total, cash, setCash, change, processing, processSale, paymentMethod, setPaymentMethod, discountOpen, setDiscountOpen, discountInput, setDiscountInput, hideHeader }: CartPanelProps) {
  const applyDiscount = () => {
    setDiscount(Math.max(0, Number(discountInput) || 0));
    setDiscountOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-hidden">
      {!hideHeader && (
        <div className="px-4 py-3 border-b flex items-center flex-shrink-0 border-sidebar-accent/30">
          <div className="flex items-center gap-2 font-bold"><ShoppingCart className="h-5 w-5" /> Bill Summary</div>
        </div>
      )}

      {/* Totals — always visible, never scrolls */}
      <div className="flex-1 flex flex-col justify-between min-h-0 p-3 gap-3">

        {/* Summary rows */}
        <div className="space-y-2 bg-sidebar-accent/30 px-3 py-2.5 rounded-lg">
          <Row label="Items:" value={cart.reduce((s, i) => s + i.qty, 0).toString()} />
          <Row label="Subtotal:" value={fmt(subtotal)} />
          {discount > 0 && (
            <div className="flex items-center justify-between text-sm">
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
          <div className="flex items-center justify-between pt-2 border-t border-sidebar-accent/30">
            <span className="font-bold text-sm">Net Total:</span>
            <span className="text-xl font-bold text-green-500">{fmt(total)}</span>
          </div>
        </div>

        {/* Cash received */}
        {paymentMethod === "cash" && (
          <div className="space-y-1.5 bg-sidebar-accent/20 px-3 py-2.5 rounded-lg">
            <label className="text-xs font-semibold text-sidebar-foreground/80">Cash Received (Rs.)</label>
            <Input
              type="number"
              className="h-9 w-full text-right text-base font-bold"
              value={cash}
              onChange={e => setCash(e.target.value)}
              placeholder="0.00"
            />
            <div className="flex items-center justify-between pt-1.5 border-t border-sidebar-accent/30">
              <span className="text-xs font-semibold text-sidebar-foreground/80">Change</span>
              <span className="text-base font-bold text-green-500">{fmt(change)}</span>
            </div>
          </div>
        )}

        {/* Payment method */}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={paymentMethod === "cash" ? "default" : "outline"} size="sm"
            onClick={() => setPaymentMethod("cash")} className="text-sm h-9">
            <Banknote className="h-4 w-4 mr-1" /> Cash
          </Button>
          <Button type="button" variant="outline" size="sm"
            onClick={() => setPaymentMethod("card")}
            className={`text-sm h-9 transition-colors ${
              paymentMethod === "card"
                ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 hover:border-blue-700"
                : "border-blue-500 text-blue-500 hover:bg-blue-500/10"
            }`}>
            <CreditCard className="h-4 w-4 mr-1" /> Card
          </Button>
        </div>
      </div>

      {/* Bottom actions — always pinned */}
      <div className="px-3 pb-3 pt-2 border-t border-sidebar-accent/30 space-y-2 flex-shrink-0">
        <Button
          disabled={processing || cart.length === 0}
          onClick={processSale}
          className="w-full h-11 text-base font-semibold"
        >
          {processing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Process Sale
        </Button>

        {/* Discount Popover trigger */}
        <Popover open={discountOpen} onOpenChange={(o) => {
          setDiscountOpen(o);
          if (o) setDiscountInput(discount > 0 ? String(discount) : "");
        }}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`w-full text-xs font-semibold h-8 gap-1.5 ${
                discount > 0 ? "border-orange-500/60 text-orange-400 bg-orange-500/10" : ""
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              {discount > 0 ? `Discount: ${fmt(discount)}` : "Add Discount"}
              <kbd className="ml-auto text-[10px] opacity-50 font-mono bg-muted px-1 rounded">F10</kbd>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-64 p-3 space-y-3">
            <div className="text-sm font-semibold flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-orange-400" /> Discount Amount (Rs.)
            </div>
            <Input
              type="number"
              min={0}
              autoFocus
              className="h-10 text-right text-lg font-bold"
              placeholder="0.00"
              value={discountInput}
              onChange={e => setDiscountInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") applyDiscount();
                if (e.key === "Escape") setDiscountOpen(false);
              }}
            />
            {subtotal > 0 && Number(discountInput) > 0 && (
              <p className="text-xs text-muted-foreground text-right -mt-1">
                = {((Number(discountInput) / subtotal) * 100).toFixed(1)}% off
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={applyDiscount}>Apply</Button>
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
    <div className="flex items-center justify-between text-sm">
      <span className="text-sidebar-foreground/80">{label}</span>
      <span className={bold ? "font-bold text-base text-sidebar-foreground" : "font-semibold text-sidebar-foreground"}>{value}</span>
    </div>
  );
}
