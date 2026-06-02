import { greedyBreakdown, pluralize, type ProductUnit } from "@/lib/units";

export function StockBreakdownBadge({
  stock,
  units,
}: {
  stock: number;
  units: Pick<ProductUnit, "id" | "name" | "equals_base">[];
}) {
  if (!units || units.length <= 1) return <span className="text-muted-foreground">—</span>;
  const rows = greedyBreakdown(stock, units).filter((r) => r.count > 0);
  if (rows.length === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((r) => (
        <span
          key={r.id}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          <span className="font-semibold">{r.count}</span>
          <span className="text-muted-foreground">{pluralize(r.name, r.count)}</span>
        </span>
      ))}
    </div>
  );
}
