"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as cfg from "@/domains/support/config";

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;
async function act<T>(orgSlug: string, fn: (ctx: Ctx) => Promise<T>) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => fn(ctx));
  if (res.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}

export const saveBusinessHoursAction = async (s: string, input: unknown) => act(s, (c) => cfg.saveBusinessHours(c, input));
export const addHolidayAction = async (s: string, input: unknown) => act(s, (c) => cfg.addHoliday(c, input));
export const removeHolidayAction = async (s: string, id: string) => act(s, (c) => cfg.removeHoliday(c, id));
export const saveSlaPolicyAction = async (s: string, id: string | null, input: unknown) => act(s, (c) => (id ? cfg.updateSlaPolicy(c, id, input).then(() => ({ id })) : cfg.createSlaPolicy(c, input)));
export const archiveSlaPolicyAction = async (s: string, id: string) => act(s, (c) => cfg.archiveSlaPolicy(c, id));
export const moveSlaPolicyAction = async (s: string, id: string, dir: "up" | "down") => act(s, (c) => cfg.moveSlaPolicy(c, id, dir));
export const saveRoutingRuleAction = async (s: string, id: string | null, input: unknown) => act(s, (c) => (id ? cfg.updateRoutingRule(c, id, input).then(() => ({ id })) : cfg.createRoutingRule(c, input)));
export const archiveRoutingRuleAction = async (s: string, id: string) => act(s, (c) => cfg.archiveRoutingRule(c, id));
export const moveRoutingRuleAction = async (s: string, id: string, dir: "up" | "down") => act(s, (c) => cfg.moveRoutingRule(c, id, dir));
export const saveTicketFormAction = async (s: string, id: string | null, input: unknown) => act(s, (c) => (id ? cfg.updateTicketForm(c, id, input).then(() => ({ id })) : cfg.createTicketForm(c, input)));
export const publishTicketFormAction = async (s: string, id: string) => act(s, (c) => cfg.publishTicketForm(c, id));
export const archiveTicketFormAction = async (s: string, id: string) => act(s, (c) => cfg.archiveTicketForm(c, id));
export const savePortalAction = async (s: string, input: unknown) => act(s, (c) => cfg.savePortal(c, input));
