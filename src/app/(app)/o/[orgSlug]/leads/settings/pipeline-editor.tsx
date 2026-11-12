"use client";
import { ArrowDown, ArrowUp, Archive, Pencil, Plus, Star } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { REQUIRABLE_FIELDS, STAGE_COLORS } from "@/domains/sales/validation";
import { archivePipelineAction, archiveStageAction, createPipelineAction, reorderStagesAction, saveStageAction, updatePipelineAction } from "../actions";
import { STAGE_BAR } from "../_components/labels";

interface Stage { id: string; name: string; color: string; probability: number; category: string; requiredFields: string[]; leadCount: number }
interface Pipeline { id: string; name: string; isDefault: boolean; stages: Stage[] }

function StageDialog({ orgSlug, pipelineId, stage, trigger }: { orgSlug: string; pipelineId: string; stage?: Stage; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const init = { name: stage?.name ?? "", color: stage?.color ?? "teal", probability: String(stage?.probability ?? 50), category: stage?.category ?? "open", requiredFields: stage?.requiredFields ?? [] };
  const [f, setF] = useState(init);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setF(init); setErrors({}); setFormError(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form noValidate onSubmit={(e) => { e.preventDefault(); start(async () => {
          const r = await saveStageAction(orgSlug, pipelineId, stage?.id ?? null, { ...f, probability: Number(f.probability) });
          if (r.ok) { toast.success(stage ? "Stage saved" : "Stage added"); setOpen(false); } else { setErrors(r.fieldErrors ?? {}); setFormError(r.error); }
        }); }}>
          <DialogHeader><DialogTitle>{stage ? `Edit ${stage.name}` : "Add stage"}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            {formError && <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{formError}</p>}
            <FormField label="Name" htmlFor="stage-name" required errors={errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Type" htmlFor="stage-cat" errors={errors.category}>
                <NativeSelect value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="open">Open</option><option value="won">Won</option><option value="lost">Lost</option></NativeSelect>
              </FormField>
              <FormField label="Win probability %" htmlFor="stage-prob" errors={errors.probability}><Input type="number" min={0} max={100} value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} /></FormField>
              <FormField label="Color" htmlFor="stage-color">
                <NativeSelect value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })}>{STAGE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect>
              </FormField>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Required before entering this stage</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(REQUIRABLE_FIELDS).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--brand-primary)]" checked={f.requiredFields.includes(k)} onChange={(e) => setF({ ...f, requiredFields: e.target.checked ? [...f.requiredFields, k] : f.requiredFields.filter((x) => x !== k) })} /> {l}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save stage"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveStageDialog({ orgSlug, stage, others }: { orgSlug: string; stage: Stage; others: Stage[] }) {
  const sameKind = others.filter((o) => o.category === stage.category);
  const [moveTo, setMoveTo] = useState(sameKind[0]?.id ?? "");
  return (
    <ConfirmDialog
      trigger={<Button size="icon" variant="ghost" aria-label={`Archive ${stage.name}`}><Archive /></Button>}
      title={`Archive “${stage.name}”?`}
      description={
        stage.leadCount > 0 ? (
          <span className="grid gap-2">
            <span>{stage.leadCount} lead(s) are in this stage. Choose where to move them (stage history is recorded):</span>
            <select aria-label="Move leads to" className="h-9 rounded-md border bg-card px-2 text-sm text-ink" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {sameKind.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </span>
        ) : "The stage is hidden from the board. Its history stays on past leads."
      }
      confirmLabel="Archive stage"
      onConfirm={() => archiveStageAction(orgSlug, stage.id, stage.leadCount > 0 ? moveTo : null)}
      successMessage="Stage archived"
    />
  );
}

export function PipelineEditor({ orgSlug, pipelines }: { orgSlug: string; pipelines: Pipeline[] }) {
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => start(async () => { const r = await fn(); if (r.ok) toast.success(msg); else toast.error(r.error ?? "Failed"); });

  return (
    <div className="space-y-6">
      {pipelines.map((p) => (
        <Card key={p.id}>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              {p.name} {p.isDefault && <Badge tone="highlight"><Star className="size-3" /> Default</Badge>}
            </CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => { const n = prompt("Pipeline name", p.name); if (n) run(() => updatePipelineAction(orgSlug, p.id, { name: n }), "Pipeline renamed"); }}><Pencil /> Rename</Button>
              {!p.isDefault && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updatePipelineAction(orgSlug, p.id, { isDefault: true }), "Default pipeline set")}><Star /> Make default</Button>}
              {pipelines.length > 1 && (
                <ConfirmDialog trigger={<Button size="sm" variant="ghost"><Archive /> Archive</Button>} title={`Archive ${p.name}?`} description="Only pipelines without open leads can be archived. Closed leads keep their history." confirmLabel="Archive pipeline" onConfirm={() => archivePipelineAction(orgSlug, p.id)} successMessage="Pipeline archived" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ol className="divide-y rounded-md border">
              {p.stages.map((s, i) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className={`size-3 rounded-full ${STAGE_BAR[s.color] ?? "bg-primary"}`} aria-hidden />
                  <span className="min-w-32 flex-1 font-medium">{s.name}</span>
                  <Badge tone={s.category === "won" ? "success" : s.category === "lost" ? "danger" : "neutral"}>{s.category}</Badge>
                  <span className="w-12 text-right text-xs text-muted-foreground">{s.probability}%</span>
                  <span className="w-20 text-right text-xs text-muted-foreground">{s.leadCount} lead(s)</span>
                  {s.requiredFields.length > 0 && <span className="text-xs text-muted-foreground">Requires: {s.requiredFields.map((f) => REQUIRABLE_FIELDS[f as keyof typeof REQUIRABLE_FIELDS]).join(", ")}</span>}
                  <div className="ml-auto flex">
                    <Button size="icon" variant="ghost" aria-label={`Move ${s.name} up`} disabled={i === 0 || pending} onClick={() => { const ids = p.stages.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; run(() => reorderStagesAction(orgSlug, p.id, ids), "Order saved"); }}><ArrowUp /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Move ${s.name} down`} disabled={i === p.stages.length - 1 || pending} onClick={() => { const ids = p.stages.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; run(() => reorderStagesAction(orgSlug, p.id, ids), "Order saved"); }}><ArrowDown /></Button>
                    <StageDialog orgSlug={orgSlug} pipelineId={p.id} stage={s} trigger={<Button size="icon" variant="ghost" aria-label={`Edit ${s.name}`}><Pencil /></Button>} />
                    <ArchiveStageDialog orgSlug={orgSlug} stage={s} others={p.stages.filter((x) => x.id !== s.id)} />
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-3"><StageDialog orgSlug={orgSlug} pipelineId={p.id} trigger={<Button size="sm" variant="outline"><Plus /> Add stage</Button>} /></div>
          </CardContent>
        </Card>
      ))}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) run(async () => { const r = await createPipelineAction(orgSlug, newName); if (r.ok) setNewName(""); return r; }, "Pipeline created"); }}>
        <Input aria-label="New pipeline name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New pipeline, e.g. Wholesale" className="max-w-xs" />
        <Button type="submit" variant="outline" disabled={pending || !newName.trim()}><Plus /> Add pipeline</Button>
      </form>
    </div>
  );
}
