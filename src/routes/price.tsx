import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { fmt } from "@/lib/format";
import { toast } from "sonner";
import {
  Loader2,
  ScanLine,
  Camera,
  X,
  Store,
  Search,
  Package,
  BadgeDollarSign,
  Tag,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/price")({
  component: PriceCheckPage,
  head: () => ({
    meta: [
      { title: "ZIC Mart - Price Check" },
      { name: "description", content: "Check product prices at ZIC Mart" },
    ],
  }),
});

const PAGE_SIZE = 60;

interface PriceProduct {
  id: string;
  barcode: string;
  name: string;
  sale_price: number;
  stock: number;
  category_id: string | null;
}
interface PriceUnit {
  id: string;
  product_id: string;
  name: string;
  equals_base: number;
  is_base: boolean;
  is_default_sale: boolean;
  barcode: string | null;
  sale_price: number;
}
interface ViewItem {
  product: PriceProduct;
  unit: PriceUnit | null;
  units: PriceUnit[];
}

const pickDefaultUnit = (units: PriceUnit[]): PriceUnit | undefined =>
  units.find((u) => u.is_default_sale) ?? units.find((u) => u.is_base) ?? units[0];

/** One viewed row. Memoized so selecting/removing doesn't re-render every row. */
const ViewRow = memo(function ViewRow({
  item,
  selected,
  onSelect,
  onRemove,
}: {
  item: ViewItem;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const price = item.unit ? Number(item.unit.sale_price) : Number(item.product.sale_price);
  return (
    <div
      onClick={onSelect}
      className={`grid gap-1 px-2 sm:px-4 py-2 items-center cursor-pointer transition-colors
        [grid-template-columns:1fr_6.5rem_1.75rem]
        sm:[grid-template-columns:1fr_8rem_2rem]
        ${selected ? "bg-primary/10" : "hover:bg-muted/30"}`}
    >
      <div className="min-w-0">
        <div className="font-medium text-xs sm:text-sm truncate">{item.product.name}</div>
        <div className="text-[10px] sm:text-xs text-muted-foreground truncate">
          {item.unit?.name ?? "Piece"}
        </div>
      </div>
      <div className="text-right text-sm sm:text-base font-bold text-primary">{fmt(price)}</div>
      <button
        className="flex items-center justify-center h-6 w-6 rounded text-red-500 hover:text-red-700 hover:bg-red-100 justify-self-end"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});

function PriceCheckPage() {
  const [products, setProducts] = useState<PriceProduct[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [scan, setScan] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [items, setItems] = useState<ViewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualResults, setManualResults] = useState<PriceProduct[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const manualSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const unitsCache = useRef<Record<string, PriceUnit[]>>({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("price_categories");
      setCats((data ?? []) as { id: string; name: string }[]);
    })();
  }, []);

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  // Batch-prefetch unit prices for whatever products are on screen.
  const prefetchUnits = useCallback(async (list: { id: string }[]) => {
    const missing = list.map((p) => p.id).filter((id) => !(id in unitsCache.current));
    if (missing.length === 0) return;
    const { data } = await supabase.rpc("price_units", { _product_ids: missing });
    const next = { ...unitsCache.current };
    for (const id of missing) next[id] = [];
    for (const u of (data ?? []) as PriceUnit[]) (next[u.product_id] ??= []).push(u);
    unitsCache.current = next;
  }, []);

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    fetchTimerRef.current = setTimeout(
      async () => {
        const { data, error } = await supabase.rpc("price_search", {
          _search: search.trim(),
          _category: (cat === "all" ? null : cat) as string,
          _limit: PAGE_SIZE,
          _offset: page * PAGE_SIZE,
        });
        if (error) {
          console.error("Price search error:", error);
          return;
        }
        const rows = (data ?? []) as (PriceProduct & { total_count: number })[];
        if (cancelled) return;
        setProducts(rows);
        setTotalCount(rows.length ? Number(rows[0].total_count) : 0);
        void prefetchUnits(rows);
      },
      search ? 350 : 0,
    );
    return () => {
      cancelled = true;
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
  }, [page, search, cat, prefetchUnits]);

  useEffect(() => {
    setPage(0);
  }, [search, cat]);

  const loadUnits = useCallback(async (id: string): Promise<PriceUnit[]> => {
    if (unitsCache.current[id]) return unitsCache.current[id];
    const { data } = await supabase.rpc("price_units", { _product_ids: [id] });
    const units = (data ?? []) as PriceUnit[];
    unitsCache.current = { ...unitsCache.current, [id]: units };
    return units;
  }, []);

  const addToView = useCallback(
    async (p: PriceProduct, unit?: PriceUnit) => {
      const units = await loadUnits(p.id);
      const chosen = unit ?? pickDefaultUnit(units) ?? null;
      setItems((prev) => {
        const existing = prev.find((i) => i.product.id === p.id);
        if (existing) {
          return prev.map((i) =>
            i.product.id === p.id ? { ...i, product: p, unit: chosen ?? i.unit, units } : i,
          );
        }
        return [{ product: p, unit: chosen, units }, ...prev];
      });
      setSelectedId(p.id);
    },
    [loadUnits],
  );

  const selectUnit = useCallback((productId: string, unit: PriceUnit) => {
    setItems((prev) => prev.map((i) => (i.product.id === productId ? { ...i, unit } : i)));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.product.id !== productId);
      setSelectedId((cur) => (cur === productId ? (next[0]?.product.id ?? null) : cur));
      return next;
    });
  }, []);

  const lookupBarcode = useCallback(
    async (raw: string, quiet = false) => {
      const code = raw.trim().replace(/[\s-]/g, "");
      if (!code) return;
      const { data } = await supabase.rpc("price_lookup_barcode", { _code: code });
      const row = (data ?? [])[0] as
        | {
            product_id: string;
            barcode: string;
            name: string;
            sale_price: number;
            stock: number;
            category_id: string | null;
            unit_id: string | null;
            unit_name: string | null;
            unit_equals_base: number | null;
            unit_sale_price: number | null;
            unit_barcode: string | null;
          }
        | undefined;
      if (!row) {
        if (!quiet) toast.error(`No product found: ${code}`);
        return;
      }
      const product: PriceProduct = {
        id: row.product_id,
        barcode: row.barcode,
        name: row.name,
        sale_price: Number(row.sale_price),
        stock: Number(row.stock),
        category_id: row.category_id,
      };
      const unit: PriceUnit | undefined = row.unit_id
        ? {
            id: row.unit_id,
            product_id: row.product_id,
            name: row.unit_name ?? "Unit",
            equals_base: Number(row.unit_equals_base ?? 1),
            is_base: false,
            is_default_sale: false,
            barcode: row.unit_barcode,
            sale_price: Number(row.unit_sale_price ?? row.sale_price),
          }
        : undefined;
      await addToView(product, unit);
      toast.success(`Found: ${product.name}${unit ? ` (${unit.name})` : ""}`);
    },
    [addToView],
  );

  const onScan = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan("");
    await lookupBarcode(code);
  };

  const handleCameraScan = async (code: string) => {
    await lookupBarcode(code);
  };

  useEffect(() => {
    if (!searchOpen) return;
    if (manualSearchTimer.current) clearTimeout(manualSearchTimer.current);
    manualSearchTimer.current = setTimeout(
      async () => {
        setManualLoading(true);
        const { data } = await supabase.rpc("price_search", {
          _search: manualSearch.trim(),
          _category: (cat === "all" ? null : cat) as string,
          _limit: 100,
          _offset: 0,
        });
        const rows = (data ?? []) as PriceProduct[];
        setManualResults(rows);
        void prefetchUnits(rows);
        setManualLoading(false);
      },
      manualSearch ? 300 : 0,
    );
    return () => {
      if (manualSearchTimer.current) clearTimeout(manualSearchTimer.current);
    };
  }, [manualSearch, searchOpen, cat, prefetchUnits]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const selected = items.find((i) => i.product.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Topbar ── */}
      <header className="flex items-center justify-between px-2 sm:px-4 py-2 border-b bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-sidebar-primary shrink-0">
            <Store className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-xs sm:text-sm leading-tight truncate">ZIC Mart</div>
            <div className="text-[10px] sm:text-xs opacity-70 leading-tight truncate">
              Price Check
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold uppercase tracking-wide bg-sidebar-accent/50 rounded-full px-2.5 py-1">
          <BadgeDollarSign className="h-3.5 w-3.5" /> View only
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
                    placeholder="Scan or type barcode to check price…"
                    value={scan}
                    onChange={(e) => setScan(e.target.value)}
                    autoComplete="off"
                  />
                </div>
              </form>
              <Button
                type="button"
                variant="outline"
                className="h-9 sm:h-11 px-2 sm:px-3 shrink-0"
                onClick={() => setCameraOpen(true)}
                title="Scan with camera"
              >
                <Camera className="h-4 w-4 sm:h-5 sm:w-5" />
              </Button>
            </div>
            <div className="mt-2 sm:mt-3">
              <Button
                className="w-full h-9 sm:h-11 text-sm sm:text-base font-semibold"
                onClick={() => setSearchOpen(true)}
              >
                <Search className="h-4 w-4 sm:h-5 sm:w-5 mr-1.5 sm:mr-2" /> Search Products
              </Button>
            </div>
          </Card>

          {/* Mobile selected price */}
          {selected && (
            <div className="lg:hidden shrink-0">
              <PricePanel item={selected} onSelectUnit={selectUnit} />
            </div>
          )}

          {/* Viewed items list */}
          <Card className="flex-1 overflow-hidden p-0 min-h-0">
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-2 sm:px-4 py-2 border-b shrink-0">
                <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
                  <Tag className="h-4 w-4" /> Checked Items
                  {items.length > 0 && (
                    <span className="text-xs font-semibold text-muted-foreground">
                      ({items.length})
                    </span>
                  )}
                </div>
                {items.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => {
                      setItems([]);
                      setSelectedId(null);
                    }}
                  >
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                )}
              </div>
              {items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <Package className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground/30 mb-3" />
                  <p className="font-medium text-base sm:text-lg text-muted-foreground">
                    No prices checked yet
                  </p>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Scan a barcode or search to view prices
                  </p>
                </div>
              ) : (
                <div className="overflow-auto flex-1 divide-y">
                  {items.map((i) => (
                    <ViewRow
                      key={i.product.id}
                      item={i}
                      selected={i.product.id === selectedId}
                      onSelect={() => setSelectedId(i.product.id)}
                      onRemove={() => removeItem(i.product.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* ── Right sidebar (desktop): selected price detail ── */}
        <div className="hidden lg:flex w-80 xl:w-96 flex-col bg-sidebar border-l shrink-0 overflow-hidden">
          {selected ? (
            <PricePanel item={selected} onSelectUnit={selectUnit} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-sidebar-foreground/70">
              <Sparkles className="h-10 w-10 mb-3 opacity-40" />
              <p className="font-medium">Price details</p>
              <p className="text-xs mt-1">Scan or select an item to see its price.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Product Search Sheet (bottom) ── */}
      <Sheet
        open={searchOpen}
        onOpenChange={(val) => {
          setSearchOpen(val);
          if (!val) {
            setManualSearch("");
            setManualResults([]);
          }
        }}
      >
        <SheetContent side="bottom" className="w-full h-[90dvh] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-sm sm:text-base">
              <Search className="h-4 w-4 sm:h-5 sm:w-5" /> Search Products
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="p-3 sm:p-4 border-b shrink-0 space-y-2">
              <Input
                placeholder="Search products..."
                value={manualSearch}
                onChange={(e) => setManualSearch(e.target.value)}
                className="h-9 sm:h-10"
                autoFocus
              />
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <Button
                  size="sm"
                  variant={cat === "all" ? "default" : "outline"}
                  className="shrink-0 text-xs h-7 px-2.5"
                  onClick={() => setCat("all")}
                >
                  All
                </Button>
                {cats.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant={cat === c.id ? "default" : "outline"}
                    className="shrink-0 text-xs h-7 px-2.5"
                    onClick={() => setCat(c.id)}
                  >
                    {c.name}
                  </Button>
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
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-3">
                  {manualResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        addToView(p);
                        setSearchOpen(false);
                        setManualSearch("");
                        setManualResults([]);
                      }}
                      className="text-left p-2 sm:p-3 rounded-xl border bg-card hover:border-primary hover:shadow-lg transition-all flex flex-col"
                    >
                      <div className="font-semibold text-xs sm:text-sm line-clamp-2 flex-1">
                        {p.name}
                      </div>
                      <div className="mt-1.5 sm:mt-2 flex items-center justify-between gap-1">
                        <span className="font-bold text-primary text-xs sm:text-sm">
                          {fmt(p.sale_price)}
                        </span>
                        <span
                          className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-full shrink-0 ${
                            Number(p.stock) === 0
                              ? "bg-destructive text-destructive-foreground"
                              : "bg-muted"
                          }`}
                        >
                          {p.stock}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex flex-col items-center justify-between gap-2 pt-4 border-t mt-4 sm:flex-row">
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} / {totalPages} &nbsp;·&nbsp; {totalCount.toLocaleString()}{" "}
                    products
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-3 py-1 text-xs sm:text-sm rounded border bg-card hover:bg-muted disabled:opacity-40"
                    >
                      ← Prev
                    </button>
                    <button
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-3 py-1 text-xs sm:text-sm rounded border bg-card hover:bg-muted disabled:opacity-40"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <BarcodeScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScan={handleCameraScan}
      />
    </div>
  );
}

/* ─────────────────────────── Price Panel ─────────────────────────── */

function PricePanel({
  item,
  onSelectUnit,
}: {
  item: ViewItem;
  onSelectUnit: (productId: string, unit: PriceUnit) => void;
}) {
  const activeUnit = item.unit ?? null;
  const price = activeUnit ? Number(activeUnit.sale_price) : Number(item.product.sale_price);

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground overflow-hidden">
      <div className="px-4 py-3 border-b shrink-0 border-sidebar-accent/30">
        <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
          <BadgeDollarSign className="h-4 w-4 sm:h-5 sm:w-5" /> Price
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 min-h-0">
        <div className="rounded-lg bg-sidebar-accent/30 p-3 sm:p-4">
          <div className="text-sm sm:text-base font-semibold leading-snug">{item.product.name}</div>
          {item.product.barcode && (
            <div className="text-[11px] sm:text-xs text-sidebar-foreground/60 mt-0.5 font-mono">
              {item.product.barcode}
            </div>
          )}
          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="text-[11px] sm:text-xs text-sidebar-foreground/70">
                {activeUnit?.name ?? "Price"}
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-green-500 leading-none mt-0.5">
                {fmt(price)}
              </div>
            </div>
          </div>
        </div>

        {item.units.length > 1 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-sidebar-foreground/80">Unit Prices</div>
            <div className="space-y-1.5">
              {item.units.map((u) => {
                const active = (activeUnit?.id ?? null) === u.id;
                return (
                  <button
                    key={u.id}
                    onClick={() => onSelectUnit(item.product.id, u)}
                    className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary/15 font-semibold"
                        : "border-sidebar-accent/40 hover:bg-sidebar-accent/30"
                    }`}
                  >
                    <span className="truncate">{u.name}</span>
                    <span className="font-bold text-primary shrink-0">
                      {fmt(Number(u.sale_price))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
