import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, MessageSquare, Star, Trash2, Check } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/feedback")({
  component: AdminFeedback,
});

interface Feedback {
  id: string;
  name: string | null;
  contact: string | null;
  rating: number | null;
  category: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

const STATUSES = [
  { value: "new", label: "New", className: "bg-blue-100 text-blue-800" },
  { value: "reviewed", label: "Reviewed", className: "bg-amber-100 text-amber-800" },
  { value: "resolved", label: "Resolved", className: "bg-green-100 text-green-800" },
  { value: "archived", label: "Archived", className: "bg-muted text-muted-foreground" },
];

const CATEGORY_LABEL: Record<string, string> = {
  general: "General",
  suggestion: "Suggestion",
  complaint: "Complaint",
  compliment: "Compliment",
  product: "Product",
  service: "Service",
};

function AdminFeedback() {
  const [rows, setRows] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Feedback | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("new");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("customer_feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows((data ?? []) as Feedback[]);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (fb: Feedback) => {
    setEditing(fb);
    setNotes(fb.admin_notes ?? "");
    setStatus(fb.status);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_feedback")
      .update({ status, admin_notes: notes || null })
      .eq("id", editing.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Feedback updated");
    setEditing(null);
    void load();
  };

  const del = async (id: string) => {
    if (!confirm("Delete this feedback? This cannot be undone.")) return;
    const { error } = await supabase.from("customer_feedback").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    void load();
  };

  const counts = {
    all: rows.length,
    new: rows.filter((r) => r.status === "new").length,
  };

  return (
    <>
      <main className="flex-1 p-6 md:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageSquare className="h-6 w-6" /> Customer Feedback
            </h1>
            <p className="text-sm text-muted-foreground">
              Suggestions, complaints and compliments from customers
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(["all", "new", "reviewed", "resolved", "archived"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
                {f === "new" && counts.new > 0 && (
                  <span className="ml-1.5 text-xs bg-primary-foreground text-primary rounded-full px-1.5">
                    {counts.new}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p>No feedback yet.</p>
            <p className="text-xs mt-2">
              Share the link <code className="bg-muted px-1.5 py-0.5 rounded">/feedback</code> with
              customers.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3">
            {rows.map((fb) => {
              const st = STATUSES.find((s) => s.value === fb.status) ?? STATUSES[0];
              return (
                <Card key={fb.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{fb.name || "Anonymous"}</span>
                      {fb.contact && (
                        <span className="text-xs text-muted-foreground">· {fb.contact}</span>
                      )}
                      <span className="text-xs bg-muted px-2 py-0.5 rounded-full">
                        {CATEGORY_LABEL[fb.category] ?? fb.category}
                      </span>
                      {fb.rating != null && (
                        <span className="inline-flex items-center gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <Star
                              key={n}
                              className={`h-3.5 w-3.5 ${
                                n <= fb.rating!
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-muted-foreground/30"
                              }`}
                            />
                          ))}
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.className}`}
                      >
                        {st.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(fb.created_at).toLocaleString()}
                    </div>
                  </div>

                  <p className="text-sm whitespace-pre-wrap">{fb.message}</p>

                  {fb.admin_notes && (
                    <div className="text-xs bg-muted/50 border-l-2 border-primary/40 px-3 py-2 rounded">
                      <span className="font-medium">Admin notes: </span>
                      {fb.admin_notes}
                    </div>
                  )}

                  <div className="flex gap-2 justify-end pt-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(fb)}>
                      <Check className="h-4 w-4 mr-1" /> Update
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => del(fb.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Feedback</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="text-sm bg-muted/40 p-3 rounded">{editing.message}</div>
              <div>
                <Label>Status</Label>
                <div className="flex gap-2 flex-wrap mt-2">
                  {STATUSES.map((s) => (
                    <Button
                      key={s.value}
                      size="sm"
                      variant={status === s.value ? "default" : "outline"}
                      onClick={() => setStatus(s.value)}
                    >
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Admin Notes (internal)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Notes for your team..."
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
