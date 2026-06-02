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
    if (c > 0 || u.equals_base === 1) out.push({ id: u.id, name: u.name, equals_base: u.equals_base, count: c });
  }
  return out;
}

export function formatBreakdown(rows: { name: string; count: number }[]): string {
  const parts = rows.filter((r) => r.count > 0).map((r) => `${r.count} ${pluralize(r.name, r.count)}`);
  return parts.length ? parts.join(" + ") : "0";
}

export function pluralize(name: string, n: number): string {
  if (n === 1) return name;
  // Naive pluralization that matches the reference UI
  if (/[sx]$/i.test(name)) return name + "es";
  if (/y$/i.test(name)) return name.slice(0, -1) + "ies";
  return name + "s";
}

export async function fetchUnitsByProductIds(ids: string[]): Promise<Record<string, ProductUnit[]>> {
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
