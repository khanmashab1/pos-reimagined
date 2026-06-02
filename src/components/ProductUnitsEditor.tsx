import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Star, Box } from "lucide-react";
import { marginPct, type UnitDraft } from "@/lib/units";

function genBarcode() {
  return "ZIC" + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
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
  const update = (i: number, patch: Partial<UnitDraft>) => {
    onChange(units.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));
  };
  const setBase = (i: number) => {
    onChange(units.map((u, idx) => ({ ...u, is_base: idx === i, equals_base: idx === i ? 1 : u.equals_base })));
  };
  const setDefaultSale = (i: number) => {
    onChange(units.map((u, idx) => ({ ...u, is_default_sale: idx === i })));
  };
  const remove = (i: number) => {
    if (units[i].is_base) return;
    onChange(units.filter((_, idx) => idx !== i));
  };
  const add = () => onChange([...units, { ...makeBlankUnit(), sort_order: units.length }]);

  const nameCounts = useMemo(() => {
    const c: Record<string, number> = {};
    units.forEach((u) => { const k = u.name.trim().toLowerCase(); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }, [units]);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold">Units, Conversion &amp; Pricing</div>
          <div className="text-xs text-muted-foreground">
            Define all selling units for this product. Stock is always managed in the base unit.
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-4 w-4 mr-1" /> Add Unit
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase text-muted-foreground border-b">
              <th className="text-left py-2 pr-2">Unit</th>
              <th className="text-left py-2 px-2">Equals (Base)</th>
              <th className="text-left py-2 px-2">SKU</th>
              <th className="text-left py-2 px-2">Barcode</th>
              <th className="text-right py-2 px-2">Purchase</th>
              <th className="text-right py-2 px-2">Sale</th>
              <th className="text-right py-2 px-2">Profit</th>
              <th className="py-2 pl-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {units.map((u, i) => {
              const dup = u.name.trim() && (nameCounts[u.name.trim().toLowerCase()] ?? 0) > 1;
              const m = marginPct(Number(u.sale_price), Number(u.purchase_price));
              return (
                <tr key={i} className="align-top">
                  <td className="py-2 pr-2">
                    <div className="flex items-start gap-2">
                      <Box className={`h-4 w-4 mt-2 shrink-0 ${u.is_base ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <Input
                          value={u.name}
                          placeholder="e.g. Box"
                          onChange={(e) => update(i, { name: e.target.value })}
                          className={dup ? "border-destructive" : ""}
                        />
                        <div className="mt-1 flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => setBase(i)}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${u.is_base ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                            title="Mark as base unit"
                          >
                            Base
                          </button>
                          <button
                            type="button"
                            onClick={() => setDefaultSale(i)}
                            className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${u.is_default_sale ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground"}`}
                            title="Default selling unit in POS"
                          >
                            <Star className="h-2.5 w-2.5" /> Default
                          </button>
                        </div>
                        {dup && <div className="text-[10px] text-destructive mt-1">Duplicate name</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 w-28">
                    <Input
                      type="number"
                      min={1}
                      disabled={u.is_base}
                      value={u.equals_base}
                      onChange={(e) => update(i, { equals_base: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    />
                  </td>
                  <td className="py-2 px-2 w-28">
                    <Input value={u.sku} onChange={(e) => update(i, { sku: e.target.value })} placeholder="—" />
                  </td>
                  <td className="py-2 px-2 w-40">
                    <div className="flex gap-1">
                      <Input
                        className="font-mono text-xs"
                        value={u.barcode}
                        onChange={(e) => update(i, { barcode: e.target.value })}
                        placeholder="optional"
                      />
                      <Button type="button" size="sm" variant="outline" onClick={() => update(i, { barcode: genBarcode() })}>
                        Gen
                      </Button>
                    </div>
                  </td>
                  <td className="py-2 px-2 w-24">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={u.purchase_price}
                      onChange={(e) => update(i, { purchase_price: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td className="py-2 px-2 w-24">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={u.sale_price}
                      onChange={(e) => update(i, { sale_price: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td className="py-2 px-2 text-right whitespace-nowrap text-xs">
                    <div className="font-semibold">{(Number(u.sale_price) - Number(u.purchase_price)).toFixed(2)}</div>
                    <div className="text-muted-foreground">({m.toFixed(1)}%)</div>
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={u.is_base}
                      onClick={() => remove(i)}
                      title={u.is_base ? "Base unit cannot be removed" : "Remove"}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        ℹ️ System will automatically convert between units based on these values. Stock is always stored in the base unit.
      </div>
    </div>
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
    if (Number(u.purchase_price) < 0 || Number(u.sale_price) < 0) return `Prices for "${u.name}" cannot be negative`;
  }
  return null;
}
