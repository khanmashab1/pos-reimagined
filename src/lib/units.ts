// Multi-unit helpers shared across POS, Products, Stock, Reports
import { supabase } from "@/integrations/supabase/client";

export interface ProductUnit {
  id: string;
  product_id: string;
  name: string;
  equals_base: number;
  is_base: boolean;
  is_default_sale: boolean;
  sku: string | null;
  barcode: string | null;
  purchase_price: number;
  sale_price: number;
  sort_order: number;
}

export interface UnitDraft {
  id?: string;
  name: string;
  equals_base: number;
  is_base: boolean;
  is_default_sale: boolean;
  sku: string;
  barcode: string;
  purchase_price: number;
  sale_price: number;
  sort_order: number;
}

export function toBase(qty: number, unit: Pick<ProductUnit, "equals_base">): number {
  return Math.round(qty * unit.equals_base);
}

export function marginPct(sale: number, cost: number): number {
  if (!sale || sale <= 0) return 0;
  return ((sale - cost) / sale) * 100;
}

/** Greedy decomposition: given base-unit stock + sorted units (desc), return rows with counts. */
export function greedyBreakdown(
  qtyBase: number,
  units: Pick<ProductUnit, "id" | "name" | "equals_base">[],
): { id: string; name: string; equals_base: number; count: number }[] {
  const sorted = [...units].sort((a, b) => b.equals_base - a.equals_base);
  let rem = Math.max(0, Math.floor(qtyBase));
  const out: { id: string; name: string; equals_base: number; count: number }[] = [];
  for (const u of sorted) {
    const c = Math.floor(rem / u.equals_base);
    rem -= c * u.equals_base;
    if (c > 0 || u.equals_base === 1)
      out.push({ id: u.id, name: u.name, equals_base: u.equals_base, count: c });
  }
  return out;
}

export function formatBreakdown(rows: { name: string; count: number }[]): string {
  const parts = rows
    .filter((r) => r.count > 0)
    .map((r) => `${r.count} ${pluralize(r.name, r.count)}`);
  return parts.length ? parts.join(" + ") : "0";
}

export function pluralize(name: string, n: number): string {
  if (n === 1) return name;
  // Naive pluralization that matches the reference UI
  if (/[sx]$/i.test(name)) return name + "es";
  if (/y$/i.test(name)) return name.slice(0, -1) + "ies";
  return name + "s";
}

export async function fetchUnitsByProductIds(
  ids: string[],
): Promise<Record<string, ProductUnit[]>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from("product_units")
    .select("*")
    .in("product_id", ids)
    .order("equals_base", { ascending: false });
  const out: Record<string, ProductUnit[]> = {};
  for (const u of (data ?? []) as ProductUnit[]) {
    (out[u.product_id] ??= []).push(u);
  }
  return out;
}

export function pickDefaultUnit(units: ProductUnit[]): ProductUnit | undefined {
  return units.find((u) => u.is_default_sale) ?? units.find((u) => u.is_base) ?? units[0];
}

/** Stable colour theme per unit row — keeps icons/chips consistent across editor, summary & preview. */
export interface UnitColor {
  icon: string;
  chipBg: string;
  chipText: string;
  ring: string;
  soft: string;
}

export const UNIT_COLORS: UnitColor[] = [
  {
    icon: "text-emerald-600",
    chipBg: "bg-emerald-50 dark:bg-emerald-950/40",
    chipText: "text-emerald-700 dark:text-emerald-300",
    ring: "border-emerald-200 dark:border-emerald-900",
    soft: "bg-emerald-100 dark:bg-emerald-900/40",
  },
  {
    icon: "text-amber-600",
    chipBg: "bg-amber-50 dark:bg-amber-950/40",
    chipText: "text-amber-700 dark:text-amber-300",
    ring: "border-amber-200 dark:border-amber-900",
    soft: "bg-amber-100 dark:bg-amber-900/40",
  },
  {
    icon: "text-blue-600",
    chipBg: "bg-blue-50 dark:bg-blue-950/40",
    chipText: "text-blue-700 dark:text-blue-300",
    ring: "border-blue-200 dark:border-blue-900",
    soft: "bg-blue-100 dark:bg-blue-900/40",
  },
  {
    icon: "text-violet-600",
    chipBg: "bg-violet-50 dark:bg-violet-950/40",
    chipText: "text-violet-700 dark:text-violet-300",
    ring: "border-violet-200 dark:border-violet-900",
    soft: "bg-violet-100 dark:bg-violet-900/40",
  },
  {
    icon: "text-rose-600",
    chipBg: "bg-rose-50 dark:bg-rose-950/40",
    chipText: "text-rose-700 dark:text-rose-300",
    ring: "border-rose-200 dark:border-rose-900",
    soft: "bg-rose-100 dark:bg-rose-900/40",
  },
];

export const unitColor = (i: number): UnitColor =>
  UNIT_COLORS[((i % UNIT_COLORS.length) + UNIT_COLORS.length) % UNIT_COLORS.length];
