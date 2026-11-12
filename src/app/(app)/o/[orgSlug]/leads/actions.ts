"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as sales from "@/domains/sales/service";
import type { LeadInput } from "@/domains/sales/validation";

const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

export async function createLeadAction(orgSlug: string, input: LeadInput) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.createLead(ctx, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function updateLeadFieldAction(orgSlug: string, id: string, field: string, value: unknown) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    const l = await sales.updateLeadField(ctx, id, field, value);
    return { value: (l as Record<string, unknown>)[field === "value" ? "valueAmount" : field] ?? null };
  });
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function moveLeadAction(orgSlug: string, id: string, stageId: string, beforeLeadId?: string | null, lostReason?: string | null) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.moveLead(ctx, id, { stageId, beforeLeadId, lostReason }));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function closeLeadAction(orgSlug: string, id: string, outcome: "won" | "lost", reason?: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.closeLead(ctx, id, outcome, reason));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function setLeadArchivedAction(orgSlug: string, id: string, archived: boolean) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.setLeadArchived(ctx, id, archived));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function setLeadProductsAction(orgSlug: string, id: string, products: { name: string; quantity: number }[]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.setLeadProducts(ctx, id, products));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function createPipelineAction(orgSlug: string, name: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.createPipeline(ctx, { name }));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function updatePipelineAction(orgSlug: string, id: string, input: { name?: string; isDefault?: boolean }) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.updatePipeline(ctx, id, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function archivePipelineAction(orgSlug: string, id: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.archivePipeline(ctx, id));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function saveStageAction(orgSlug: string, pipelineId: string, stageId: string | null, input: unknown) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    if (stageId) await sales.updateStage(ctx, stageId, input);
    else await sales.addStage(ctx, pipelineId, input);
  });
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function reorderStagesAction(orgSlug: string, pipelineId: string, ids: string[]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.reorderStages(ctx, pipelineId, ids));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function archiveStageAction(orgSlug: string, stageId: string, moveTo: string | null) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => sales.archiveStage(ctx, stageId, moveTo));
  if (res.ok) refresh(orgSlug);
  return res;
}
