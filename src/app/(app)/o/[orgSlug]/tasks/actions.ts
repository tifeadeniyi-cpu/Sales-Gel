"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as t from "@/domains/tasks/service";

const refresh = (slug: string) => revalidatePath(`/o/${slug}`, "layout");

export async function createTaskAction(orgSlug: string, input: t.TaskInput) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => t.createTask(ctx, input));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function updateTaskAction(orgSlug: string, id: string, patch: Record<string, unknown>) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(async () => {
    await t.updateTask(ctx, id, patch);
  });
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function setTaskDoneAction(orgSlug: string, id: string, done: boolean) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => t.setTaskDone(ctx, id, done));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function deleteTaskAction(orgSlug: string, id: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => t.deleteTask(ctx, id));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function addCommentAction(orgSlug: string, id: string, body: string, mentions: string[]) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => t.addTaskComment(ctx, id, { body, mentionMembershipIds: mentions }));
  if (res.ok) refresh(orgSlug);
  return res;
}
export async function deleteCommentAction(orgSlug: string, commentId: string) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => t.deleteTaskComment(ctx, commentId));
  if (res.ok) refresh(orgSlug);
  return res;
}
