import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Star, Box, Pencil, Barcode, Info } from "lucide-react";
import { marginPct, pluralize, unitColor, type UnitDraft } from "@/lib/units";

function genBarcode() {
  return "ZIC" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
}

function fmtPct(p: number): string {
  return Number.isInteger(p) ? `${p}%` : `${p.toFixed(2)}%`;
}

export function makeBlankUnit(): UnitDraft {
  return {
    name: "",
    equals_base: 1,
    is_base: false,
    is_default_sale: false,
    sku: "",
    barcode: "",
    purchase_price: 0,
    sale_price: 0,
    sort_order: 0,
  };
}

export function ProductUnitsEditor({
  units,
  onChange,
}: {
  units: UnitDraft[];
  onChange: (next: UnitDraft[]) => void;
}) {
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  const update = (i: number, patch: Partial<UnitDraft>) => {
    onChange(units.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  };
  const setBase = (i: number) => {
    onChange(
      units.map((u, idx) => ({
        ...u,
        is_base: idx === i,
        equals_base: idx === i ? 1 : u.equals_base,
      })),
    );
  };
  const setDefaultSale = (i: number) => {
    onChange(units.map((u, idx) => ({ ...u, is_default_sale: idx === i })));
  };
  const remove = (i: number) => {
    if (units[i].is_base) return;
    onChange(units.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([...units, { ...makeBlankUnit(), sort_order: units.length }]);
    // focus the new row's name input on next paint
    requestAnimationFrame(() => nameRefs.current[units.length]?.focus());
  };

  const baseName = units.find((u) => u.is_base)?.name?.trim() || "Piece";

  const nameCounts = useMemo(() => {
    const c: Record<string, number> = {};
    units.forEach((u) => {
      const k = u.name.trim().toLowerCase();
      if (k) c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [units]);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 p-4 border-b">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Box className="h-3.5 w-3.5" />
              </span>
              Units, Conversion &amp; Pricing
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Define every way you sell this product. Stock is always counted in{" "}
              <span className="font-medium text-foreground">{pluralize(baseName, 2)}</span>.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-primary/40 text-primary hover:bg-primary/5"
            onClick={add}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Unit
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                <th className="text-left font-medium py-2.5 px-4">Unit Name</th>
                <th className="text-left font-medium py-2.5 px-2">
                  <span className="inline-flex items-center gap-1">
                    Equals (In {pluralize(baseName, 2)})
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground/70">
                          <Info className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        How many {pluralize(baseName, 2).toLowerCase()} are in one of this unit.
                      </TooltipContent>
                    </Tooltip>
                  </span>
                </th>
                <th className="text-left font-medium py-2.5 px-2">
                  SKU <span className="normal-case text-muted-foreground/60">(optional)</span>
                </th>
                <th className="text-left font-medium py-2.5 px-2">
                  Barcode <span className="normal-case text-muted-foreground/60">(optional)</span>
                </th>
                <th className="text-right font-medium py-2.5 px-2">Purchase</th>
                <th className="text-right font-medium py-2.5 px-2">Sale</th>
                <th className="text-right font-medium py-2.5 px-2">Profit</th>
                <th className="text-center font-medium py-2.5 px-4 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {units.map((u, i) => {
                const c = unitColor(i);
                const dup = u.name.trim() && (nameCounts[u.name.trim().toLowerCase()] ?? 0) > 1;
                const profit = Number(u.sale_price) - Number(u.purchase_price);
                const m = marginPct(Number(u.sale_price), Number(u.purchase_price));
                return (
                  <tr key={i} className="align-top hover:bg-muted/20 transition-colors">
                    {/* Unit name + badges */}
                    <td className="py-3 px-4">
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`mt-0.5 h-9 w-9 shrink-0 rounded-lg flex items-center justify-center ${c.soft}`}
                        >
                          <Box className={`h-4.5 w-4.5 ${c.icon}`} />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <Input
                            ref={(el) => {
                              nameRefs.current[i] = el;
                            }}
                            value={u.name}
                            placeholder="e.g. Box"
                            onChange={(e) => update(i, { name: e.target.value })}
                            className={`h-9 font-medium ${dup ? "border-destructive focus-visible:ring-destructive" : ""}`}
                          />
                          <div className="flex flex-wrap items-center gap-1">
                            {u.is_base ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                Base Unit
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setBase(i)}
                                className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
                                title="Mark this as the base unit (stock is counted in it)"
                              >
                                Set base
                              </button>
                            )}
                            {u.is_default_sale ? (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                <Star className="h-2.5 w-2.5 fill-current" /> Default Sale Unit
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDefaultSale(i)}
                                className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-amber-400 hover:text-amber-600 transition-colors"
                                title="Pre-select this unit at checkout"
                              >
                                <Star className="h-2.5 w-2.5" /> Set default
                              </button>
                            )}
                          </div>
                          {dup && (
                            <div className="text-[10px] text-destructive">
                              Duplicate name — each unit must be unique
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Equals (in base) */}
                    <td className="py-3 px-2">
                      <div className="relative w-32">
                        <Input
                          type="number"
                          min={1}
                          disabled={u.is_base}
                          value={u.equals_base}
                          onChange={(e) =>
                            update(i, {
                              equals_base: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                          className="h-9 pr-16 disabled:opacity-70"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {pluralize(baseName, u.equals_base || 1)}
                        </span>
                      </div>
                    </td>

                    {/* SKU */}
                    <td className="py-3 px-2">
                      <Input
                        value={u.sku}
                        onChange={(e) => update(i, { sku: e.target.value })}
                        placeholder="—"
                        className="h-9 w-28"
                      />
                    </td>

                    {/* Barcode */}
                    <td className="py-3 px-2">
                      <div className="flex gap-1 w-44">
                        <Input
                          className="h-9 font-mono text-xs"
                          value={u.barcode}
                          onChange={(e) => update(i, { barcode: e.target.value })}
                          placeholder="optional"
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              className="h-9 w-9 shrink-0"
                              onClick={() => update(i, { barcode: genBarcode() })}
                            >
                              <Barcode className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Generate a barcode for this unit</TooltipContent>
                        </Tooltip>
                      </div>
                    </td>

                    {/* Purchase price */}
                    <td className="py-3 px-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={u.purchase_price}
                        onChange={(e) =>
                          update(i, { purchase_price: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="h-9 w-24 text-right"
                      />
                    </td>

                    {/* Sale price */}
                    <td className="py-3 px-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={u.sale_price}
                        onChange={(e) =>
                          update(i, { sale_price: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="h-9 w-24 text-right font-semibold"
                      />
                    </td>

                    {/* Profit */}
                    <td className="py-3 px-2 text-right whitespace-nowrap">
                      <div
                        className={`font-semibold text-sm ${profit < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                      >
                        {profit.toFixed(2)}
                      </div>
                      <div
                        className={`text-[11px] ${profit < 0 ? "text-destructive/70" : "text-emerald-600/70 dark:text-emerald-400/70"}`}
                      >
                        ({fmtPct(m)})
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground"
                              onClick={() => nameRefs.current[i]?.focus()}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit this unit</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                disabled={u.is_base}
                                onClick={() => remove(i)}
                                className="h-8 w-8 text-destructive disabled:text-muted-foreground/40"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {u.is_base ? "Base unit can't be removed" : "Remove unit"}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer hint */}
        <div className="m-4 mt-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            The system converts between units automatically using the values above. Stock is always
            stored in the base unit (<span className="font-semibold">{pluralize(baseName, 2)}</span>
            ).
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
}

export function validateUnits(units: UnitDraft[]): string | null {
  if (units.length === 0) return "Add at least one unit";
  const baseCount = units.filter((u) => u.is_base).length;
  if (baseCount !== 1) return "Mark exactly one base unit";
  const names = new Set<string>();
  for (const u of units) {
    const n = u.name.trim().toLowerCase();
    if (!n) return "Each unit needs a name";
    if (names.has(n)) return `Duplicate unit name: ${u.name}`;
    names.add(n);
    if (u.equals_base <= 0) return `Conversion for "${u.name}" must be greater than 0`;
    if (Number(u.purchase_price) < 0 || Number(u.sale_price) < 0)
      return `Prices for "${u.name}" cannot be negative`;
    if (Number(u.purchase_price) > Number(u.sale_price))
      return `Cost price cannot be greater than sale price for "${u.name}"`;
  }
  return null;
}
