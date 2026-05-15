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
}

const TABLES: TableInfo[] = [
  { key: "profiles", label: "Profiles" },
  { key: "user_roles", label: "User Roles" },
  { key: "categories", label: "Categories" },
  { key: "products", label: "Products" },
  { key: "sales", label: "Sales" },
  { key: "sale_items", label: "Sale Items" },
  { key: "returns", label: "Returns" },
  { key: "return_items", label: "Return Items" },
  { key: "cash_sessions", label: "Cash Sessions" },
  { key: "stock_entries", label: "Stock Entries" },
  { key: "suppliers", label: "Suppliers" },
  { key: "supplier_purchases", label: "Supplier Purchases" },
  { key: "supplier_payments", label: "Supplier Payments" },
  { key: "store_settings", label: "Store Settings" },
  { key: "bill_sequences", label: "Bill Sequences" },
  { key: "user_audit_log", label: "Audit Log" },
];

type BackupStatus = "idle" | "loading" | "success" | "error";

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function BackupPage() {
  const [status, setStatus] = useState<Record<string, BackupStatus>>({});
  const [allLoading, setAllLoading] = useState(false);

  const backupTable = async (table: TableInfo) => {
    setStatus(prev => ({ ...prev, [table.key]: "loading" }));
    try {
      const { data, error } = await (supabase.from(table.key as any) as any).select("*");

      if (error) {
        setStatus(prev => ({ ...prev, [table.key]: "error" }));
        toast.error(`${table.label}: ${error.message}`);
        return;
      }

      const filename = `pos-backup-${table.key}-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(data ?? [], filename);
      setStatus(prev => ({ ...prev, [table.key]: "success" }));
      setTimeout(() => setStatus(prev => ({ ...prev, [table.key]: "idle" })), 3000);
      toast.success(`${table.label} downloaded`);
    } catch (err) {
      setStatus(prev => ({ ...prev, [table.key]: "error" }));
      toast.error(`${table.label}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const backupAll = async () => {
    setAllLoading(true);
    const snapshot: Record<string, unknown> = { exported_at: new Date().toISOString() };
    let hasError = false;

    for (const table of TABLES) {
      setStatus(prev => ({ ...prev, [table.key]: "loading" }));
      const { data, error } = await (supabase.from(table.key as any) as any).select("*");

      if (error) {
        setStatus(prev => ({ ...prev, [table.key]: "error" }));
        hasError = true;
        continue;
      }
      snapshot[table.key] = data ?? [];
      setStatus(prev => ({ ...prev, [table.key]: "idle" }));
    }

    const filename = `pos-backup-full-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(snapshot, filename);
    setAllLoading(false);

    if (hasError) {
      toast.error("Some tables failed — partial backup downloaded");
    } else {
      toast.success("Full backup downloaded");
    }
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
