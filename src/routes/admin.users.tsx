import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Users as UsersIcon, ShieldCheck, History, UserPlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createUser } from "@/server/users.functions";

export const Route = createFileRoute("/admin/users")({
  component: UsersPage,
});

interface UserRow {
  id: string;
  full_name: string;
  username: string | null;
  is_active: boolean;
  role: "admin" | "cashier";
  created_at: string;
}

function UsersPage() {
  const { user, fullName } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: log }] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("user_audit_log").select("*").order("created_at", { ascending: false }).limit(100),
    ]);
    const roleMap = new Map((roles ?? []).map(r => [r.user_id, r.role as "admin" | "cashier"]));
    setUsers((profiles ?? []).map((p: any) => ({
      id: p.id, full_name: p.full_name, username: p.username, is_active: p.is_active,
      role: roleMap.get(p.id) ?? "cashier", created_at: p.created_at,
    })));
    setAudit(log ?? []);
    setLoading(false);
  }

  async function logAction(target: UserRow, action: string, details: any = {}) {
    await supabase.from("user_audit_log").insert({
      actor_id: user?.id, actor_name: fullName,
      target_user_id: target.id, target_user_name: target.full_name || target.username || "",
      action, details,
    });
  }

  async function changeRole(u: UserRow, newRole: "admin" | "cashier") {
    if (u.role === newRole) return;
    if (u.id === user?.id && newRole !== "admin") {
      toast.error("You cannot remove your own admin role");
      return;
    }
    const { error } = await supabase.from("user_roles")
      .update({ role: newRole }).eq("user_id", u.id);
    if (error) { toast.error(error.message); return; }
    await logAction(u, "role_changed", { from: u.role, to: newRole });
    toast.success(`${u.full_name || u.username} is now ${newRole}`);
    load();
  }

  async function toggleActive(u: UserRow) {
    if (u.id === user?.id) { toast.error("You cannot deactivate yourself"); return; }
    const next = !u.is_active;
    const { error } = await supabase.from("profiles").update({ is_active: next }).eq("id", u.id);
    if (error) { toast.error(error.message); return; }
    await logAction(u, next ? "activated" : "deactivated");
    toast.success(`${u.full_name || u.username} ${next ? "activated" : "deactivated"}`);
    load();
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><UsersIcon className="h-7 w-7" /> Users</h1>
          <p className="text-muted-foreground">Manage roles, activation, and view audit history</p>
        </div>
        <CreateUserDialog onCreated={load} />
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users"><ShieldCheck className="h-4 w-4 mr-1" /> Users</TabsTrigger>
          <TabsTrigger value="audit"><History className="h-4 w-4 mr-1" /> Audit History</TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card className="p-5">
            {loading ? (
              <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No users found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs uppercase">
                    <tr>
                      <th className="text-left p-3">Name</th>
                      <th className="text-left p-3">Username</th>
                      <th className="text-left p-3">Joined</th>
                      <th className="text-left p-3 w-40">Role</th>
                      <th className="text-center p-3">Status</th>
                      <th className="text-center p-3">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-t">
                        <td className="p-3 font-medium">
                          {u.full_name || "—"}
                          {u.id === user?.id && <Badge variant="outline" className="ml-2 text-xs">You</Badge>}
                        </td>
                        <td className="p-3 text-muted-foreground">{u.username || "—"}</td>
                        <td className="p-3">{new Date(u.created_at).toLocaleDateString()}</td>
                        <td className="p-3">
                          <Select value={u.role} onValueChange={(v: any) => changeRole(u, v)}>
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="cashier">Cashier</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-3 text-center">
                          {u.is_active
                            ? <Badge className="bg-success text-success-foreground">Active</Badge>
                            : <Badge variant="destructive">Disabled</Badge>}
                        </td>
                        <td className="p-3 text-center">
                          <Switch checked={u.is_active} onCheckedChange={() => toggleActive(u)} disabled={u.id === user?.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card className="p-5">
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground p-6 text-center">No audit entries yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-xs uppercase">
                    <tr>
                      <th className="text-left p-3">When</th>
                      <th className="text-left p-3">Actor</th>
                      <th className="text-left p-3">Action</th>
                      <th className="text-left p-3">Target</th>
                      <th className="text-left p-3">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map(a => (
                      <tr key={a.id} className="border-t">
                        <td className="p-3 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="p-3">{a.actor_name}</td>
                        <td className="p-3"><Badge variant="outline">{a.action}</Badge></td>
                        <td className="p-3">{a.target_user_name}</td>
                        <td className="p-3 text-xs font-mono text-muted-foreground">
                          {a.details && Object.keys(a.details).length > 0 ? JSON.stringify(a.details) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");

  function reset() {
    setEmail(""); setPassword(""); setFullName(""); setUsername(""); setRole("cashier");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    setBusy(true);
    try {
      await createUser({
        data: { email, password, full_name: fullName, username, role },
      });
      toast.success(`User created: ${fullName}`);
      reset();
      setOpen(false);
      onCreated();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><UserPlus className="h-4 w-4 mr-1" /> Create User</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <Label htmlFor="cu-name">Full name</Label>
            <Input id="cu-name" value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={100} />
          </div>
          <div>
            <Label htmlFor="cu-username">Username</Label>
            <Input id="cu-username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={50} />
          </div>
          <div>
            <Label htmlFor="cu-email">Email</Label>
            <Input id="cu-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="cu-pwd">Password</Label>
            <Input id="cu-pwd" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={128} />
            <p className="text-xs text-muted-foreground mt-1">Minimum 6 characters. Share this with the new user.</p>
          </div>
          <div>
            <Label>Role</Label>
            <Select value={role} onValueChange={(v: any) => setRole(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cashier">Cashier</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
