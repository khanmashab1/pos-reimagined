import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminSidebar } from "@/components/AdminSidebar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Check, X, Tag } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin/price-requests")({
  component: PriceRequestsPage,
});

interface PriceRequest {
  id: string;
  product_id: string;
  product_name: string;
  current_purchase_price: number;
  current_sale_price: number;
  requested_purchase_price: number;
  requested_sale_price: number;
  reason: string;
  status: string;
  requested_by_name: string;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

function PriceRequestsPage() {
  const [rows, setRows] = useState<PriceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [rejecting, setRejecting] = useState<PriceRequest | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("price_change_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as PriceRequest[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (r: PriceRequest) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("approve_price_change", {
      _request_id: r.id,
      _notes: undefined,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Prices updated");
    void load();
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    const { error } = await supabase.rpc("reject_price_change", {
      _request_id: rejecting.id,
      _notes: rejectNotes || undefined,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Request rejected");
    setRejecting(null);
    setRejectNotes("");
    void load();
  };

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Tag className="h-6 w-6" /> Price Change Requests
            </h1>
            <p className="text-sm text-muted-foreground">
              Cashier-submitted requests to update product prices
            </p>
          </div>
          <div className="flex gap-2">
            {(["pending", "approved", "rejected", "all"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3">Product</th>
                  <th className="text-left px-4 py-3">Requested By</th>
                  <th className="text-right px-4 py-3">Cost (Current → New)</th>
                  <th className="text-right px-4 py-3">Sale (Current → New)</th>
                  <th className="text-left px-4 py-3">Reason</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin inline" />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      No requests
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => {
                    const costUp = Number(r.requested_purchase_price) > Number(r.current_purchase_price);
                    const saleUp = Number(r.requested_sale_price) > Number(r.current_sale_price);
                    return (
                      <tr key={r.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 font-medium">{r.product_name}</td>
                        <td className="px-4 py-3">
                          <div>{r.requested_by_name || "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-muted-foreground">
                            {Number(r.current_purchase_price).toFixed(2)}
                          </span>{" "}
                          →{" "}
                          <span className={costUp ? "text-red-600 font-semibold" : "text-green-600 font-semibold"}>
                            {Number(r.requested_purchase_price).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-muted-foreground">
                            {Number(r.current_sale_price).toFixed(2)}
                          </span>{" "}
                          →{" "}
                          <span className={saleUp ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                            {Number(r.requested_sale_price).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[220px]">
                          {r.reason || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              r.status === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : r.status === "approved"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                            }`}
                          >
                            {r.status}
                          </span>
                          {r.reviewed_by_name && (
                            <div className="text-[11px] text-muted-foreground mt-1">
                              by {r.reviewed_by_name}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.status === "pending" ? (
                            <div className="flex gap-2 justify-end">
                              <Button
                                size="sm"
                                onClick={() => approve(r)}
                                disabled={busy === r.id}
                              >
                                <Check className="h-4 w-4 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setRejecting(r)}
                                disabled={busy === r.id}
                              >
                                <X className="h-4 w-4 mr-1" /> Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Price Request</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-3">
              <div className="text-sm font-medium">{rejecting.product_name}</div>
              <div>
                <Label>Reason (optional)</Label>
                <Textarea
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
              <Input type="hidden" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={doReject} disabled={busy === rejecting?.id}>
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
