import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS] = useState({
    store_name: "ZIC Mart", address: "", phone: "", tax_rate: 0, currency: "Rs.", footer_message: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("store_settings").select("*").eq("id", 1).single().then(({ data }) => {
      if (data) setS({
        store_name: data.store_name, address: data.address, phone: data.phone,
        tax_rate: Number(data.tax_rate), currency: data.currency, footer_message: data.footer_message,
      });
    });
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from("store_settings").update({ ...s, tax_rate: Number(s.tax_rate) }).eq("id", 1);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Store info shown on receipts and labels</p>
      </div>
      <Card className="p-6 space-y-4">
        <div><Label>Store Name</Label><Input value={s.store_name} onChange={e => setS({ ...s, store_name: e.target.value })} /></div>
        <div><Label>Address</Label><Input value={s.address} onChange={e => setS({ ...s, address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Phone</Label><Input value={s.phone} onChange={e => setS({ ...s, phone: e.target.value })} /></div>
          <div><Label>Currency Symbol</Label><Input value={s.currency} onChange={e => setS({ ...s, currency: e.target.value })} /></div>
        </div>
        <div><Label>Tax Rate (%)</Label><Input type="number" step="0.01" value={s.tax_rate} onChange={e => setS({ ...s, tax_rate: +e.target.value })} /></div>
        <div><Label>Receipt Footer Message</Label><Textarea value={s.footer_message} onChange={e => setS({ ...s, footer_message: e.target.value })} /></div>
        <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save Settings"}</Button>
      </Card>
    </div>
  );
}
