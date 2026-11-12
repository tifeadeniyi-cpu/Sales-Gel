"use client";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { deleteRoleAction, saveRoleAction } from "../actions";

export interface PermissionOption {
  key: string;
  description: string;
  domain: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  org: "Organization", members: "Members", roles: "Roles", teams: "Teams", audit: "Audit", billing: "Billing",
  customers: "Customers", leads: "Leads", pipelines: "Pipelines", conversations: "Conversations", orders: "Orders",
  payments: "Payments", refunds: "Refunds", products: "Products", tickets: "Tickets", support: "Support", knowledge: "Knowledge base",
  tasks: "Tasks", segments: "Segments", campaigns: "Campaigns", automations: "Automations", reports: "Reports", integrations: "Integrations",
};

export function RoleEditorDialog({
  orgSlug,
  permissions,
  role,
  readOnly,
}: {
  orgSlug: string;
  permissions: PermissionOption[];
  role?: { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean };
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  const grouped = useMemo(() => {
    const m = new Map<string, PermissionOption[]>();
    for (const p of permissions) m.set(p.domain, [...(m.get(p.domain) ?? []), p]);
    return [...m.entries()];
  }, [permissions]);

  const toggle = (key: string) => {
    setDirty(true);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  const reset = () => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
    setErrors({});
    setFormError(null);
    setDirty(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && dirty && !readOnly && !confirm("Discard unsaved changes?")) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {role ? (
          <Button size="sm" variant="outline">{readOnly ? "View" : <><Pencil /> Edit</>}</Button>
        ) : (
          <Button><Plus /> New role</Button>
        )}
      </DialogTrigger>
      <DialogContent side="right">
        <div className="border-b p-5 pr-12">
          <DialogHeader className="mb-0">
            <DialogTitle>{role ? (readOnly ? role.name : `Edit ${role.name}`) : "New custom role"}</DialogTitle>
            <DialogDescription>
              {role?.isSystem ? "System role. Its name is fixed, but you can adjust its permissions." : "Choose exactly what members with this role can do."}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
          <FormField label="Role name" htmlFor="role-name" required errors={errors.name}>
            <Input value={name} disabled={readOnly || role?.isSystem} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
          </FormField>
          <FormField label="Description" htmlFor="role-desc" errors={errors.description}>
            <Input value={description} disabled={readOnly} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} />
          </FormField>
          <fieldset className="space-y-4" disabled={readOnly}>
            <legend className="text-sm font-medium">Permissions <span className="font-normal text-muted-foreground">({selected.size} selected)</span></legend>
            {grouped.map(([domain, perms]) => (
              <div key={domain} className="rounded-md border">
                <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{DOMAIN_LABELS[domain] ?? domain}</div>
                <ul className="divide-y">
                  {perms.map((p) => (
                    <li key={p.key}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-muted/30">
                        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand-primary)]" checked={selected.has(p.key)} onChange={() => toggle(p.key)} />
                        <span>
                          <span className="block">{p.description}</span>
                          <code className="text-[11px] text-muted-foreground">{p.key}</code>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </fieldset>
        </div>
        {!readOnly && (
          <DialogFooter className="mt-0 border-t p-4">
            <Button variant="outline" onClick={() => { setDirty(false); setOpen(false); reset(); }}>Cancel</Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveRoleAction(orgSlug, role?.id ?? null, { name, description: description || undefined, permissions: [...selected] });
                  if (res.ok) {
                    toast.success(role ? "Role saved" : "Role created");
                    setDirty(false);
                    setOpen(false);
                  } else {
                    setErrors(res.fieldErrors ?? {});
                    setFormError(res.error);
                  }
                })
              }
            >
              {pending ? "Saving…" : "Save role"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRoleButton({ orgSlug, roleId, name }: { orgSlug: string; roleId: string; name: string }) {
  return (
    <ConfirmDialog
      trigger={<Button size="sm" variant="ghost" aria-label={`Delete ${name}`}><Trash2 /></Button>}
      title={`Delete ${name}?`}
      description="Roles can only be deleted when no members use them."
      confirmLabel="Delete role"
      onConfirm={() => deleteRoleAction(orgSlug, roleId)}
      successMessage="Role deleted"
    />
  );
}
