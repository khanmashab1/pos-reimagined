import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Database, Download, Loader2, CheckCircle2, AlertCircle, FileDown,
} from "lucide-react";

export const Route = createFileRoute("/admin/backup")({
  component: BackupPage,
});

interface TableInfo {
  key: string;
  label: string;
  group: string;
}

const TABLES: TableInfo[] = [
  // Catalog
  { key: "categories", label: "Categories", group: "Catalog" },
  { key: "products", label: "Products", group: "Catalog" },
  { key: "product_units", label: "Product Units", group: "Catalog" },
  { key: "price_change_requests", label: "Price Requests", group: "Catalog" },
  // Sales
  { key: "sales", label: "Sales", group: "Sales" },
  { key: "sale_items", label: "Sale Items", group: "Sales" },
  { key: "returns", label: "Returns", group: "Sales" },
  { key: "return_items", label: "Return Items", group: "Sales" },
  { key: "cash_sessions", label: "Cash Sessions", group: "Sales" },
  { key: "shift_expenses", label: "Shift Expenses", group: "Sales" },
  // Inventory
  { key: "stock_entries", label: "Stock Entries", group: "Inventory" },
  { key: "inventory_movements", label: "Inventory Movements", group: "Inventory" },
  { key: "stock_reconciliations", label: "Stock Reconciliations", group: "Inventory" },
  // Suppliers & Cash
  { key: "suppliers", label: "Suppliers", group: "Suppliers & Cash" },
  { key: "supplier_purchases", label: "Supplier Purchases", group: "Suppliers & Cash" },
  { key: "supplier_payments", label: "Supplier Payments", group: "Suppliers & Cash" },
  { key: "person_payments", label: "Person Payments", group: "Suppliers & Cash" },
  { key: "person_starting_balances", label: "Person Starting Balances", group: "Suppliers & Cash" },
  { key: "daily_expenses", label: "Daily Expenses", group: "Suppliers & Cash" },
  { key: "operating_expenses", label: "Operating Expenses", group: "Suppliers & Cash" },
  { key: "manual_sale_days", label: "Manual Sale Days", group: "Suppliers & Cash" },
  { key: "manual_sale_persons", label: "Manual Sale Persons", group: "Suppliers & Cash" },
  // System
  { key: "profiles", label: "Profiles", group: "System" },
  { key: "user_roles", label: "User Roles", group: "System" },
  { key: "store_settings", label: "Store Settings", group: "System" },
  { key: "bill_sequences", label: "Bill Sequences", group: "System" },
  { key: "customer_feedback", label: "Customer Feedback", group: "System" },
  { key: "user_audit_log", label: "Audit Log", group: "System" },
];

const GROUPS = Array.from(new Set(TABLES.map(t => t.group)));

type BackupStatus = "idle" | "loading" | "success" | "error";

const PAGE = 1000;

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch every row of a table, paging past the 1000-row API limit. */
async function fetchAll(key: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await (supabase.from(key as any) as any)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Record<string, unknown>[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function BackupPage() {
  const [status, setStatus] = useState<Record<string, BackupStatus>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [allLoading, setAllLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [format, setFormat] = useState<"json" | "csv">("json");

  const stamp = () => new Date().toISOString().slice(0, 10);

  const backupTable = async (table: TableInfo) => {
    setStatus(prev => ({ ...prev, [table.key]: "loading" }));
    try {
      const rows = await fetchAll(table.key);
      const base = `pos-backup-${table.key}-${stamp()}`;
      if (format === "csv") downloadCsv(rows, `${base}.csv`);
      else downloadJson(rows, `${base}.json`);
      setCounts(prev => ({ ...prev, [table.key]: rows.length }));
      setStatus(prev => ({ ...prev, [table.key]: "success" }));
      setTimeout(() => setStatus(prev => ({ ...prev, [table.key]: "idle" })), 3000);
      toast.success(`${table.label} downloaded (${rows.length} rows)`);
    } catch (err) {
      setStatus(prev => ({ ...prev, [table.key]: "error" }));
      toast.error(`${table.label}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const backupAll = async () => {
    setAllLoading(true);
    const snapshot: Record<string, unknown> = { exported_at: new Date().toISOString() };
    const rowCounts: Record<string, number> = {};
    const failed: string[] = [];

    for (const [i, table] of TABLES.entries()) {
      setProgress(`${table.label} (${i + 1}/${TABLES.length})`);
      setStatus(prev => ({ ...prev, [table.key]: "loading" }));
      try {
        const rows = await fetchAll(table.key);
        snapshot[table.key] = rows;
        rowCounts[table.key] = rows.length;
        setStatus(prev => ({ ...prev, [table.key]: "idle" }));
      } catch {
        setStatus(prev => ({ ...prev, [table.key]: "error" }));
        failed.push(table.label);
      }
    }

    snapshot.row_counts = rowCounts;
    setCounts(prev => ({ ...prev, ...rowCounts }));
    downloadJson(snapshot, `pos-backup-full-${stamp()}.json`);
    setAllLoading(false);
    setProgress("");

    if (failed.length) toast.error(`Partial backup — failed: ${failed.join(", ")}`);
    else toast.success("Full backup downloaded");
  };


  const statusIcon = (s: BackupStatus) => {
    switch (s) {
      case "loading": return <Loader2 className="h-4 w-4 animate-spin" />;
      case "success": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error": return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return <Download className="h-4 w-4" />;
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Database className="h-7 w-7" /> Backup
          </h1>
          <p className="text-muted-foreground">Export your data as JSON files</p>
        </div>
        <Button size="lg" onClick={backupAll} disabled={allLoading}>
          {allLoading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Exporting...</>
          ) : (
            <><FileDown className="h-4 w-4 mr-2" /> Download All</>
          )}
        </Button>
      </div>

      <Card className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TABLES.map(table => {
            const s = status[table.key] ?? "idle";
            return (
              <Button
                key={table.key}
                variant="outline"
                className="h-auto py-4 px-4 justify-between gap-2"
                disabled={s === "loading" || allLoading}
                onClick={() => backupTable(table)}
              >
                <span className="font-medium text-sm">{table.label}</span>
                {statusIcon(s)}
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="p-6 bg-muted/30">
        <div className="text-sm text-muted-foreground space-y-1">
          <p>Backups are downloaded as JSON files — one file per table or a single bundle.</p>
          <p>Use <code className="text-xs bg-muted px-1.5 py-0.5 rounded">supabase db dump</code> for full database snapshots.</p>
        </div>
      </Card>
    </div>
  );
}
