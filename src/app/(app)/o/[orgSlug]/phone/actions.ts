"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as acct from "@/domains/phone/account";
import * as calls from "@/domains/phone/calls";
import type { AgentStatus } from "@/domains/phone/schema";

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;
async function act<T>(orgSlug: string, fn: (ctx: Ctx) => Promise<T>, revalidate = true) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => fn(ctx));
  if (res.ok && revalidate) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}

/* softphone */
export const voiceTokenAction = async (s: string) => act(s, (c) => calls.voiceToken(c), false);
export const prepareCallAction = async (s: string, input: unknown) => act(s, (c) => calls.prepareCall(c, input), false);
export const activeCallInfoAction = async (s: string, ref: { callId?: string; callSid?: string }) => act(s, (c) => calls.activeCallInfo(c, ref), false);
export const setAvailabilityAction = async (s: string, status: AgentStatus) => act(s, (c) => acct.setAvailability(c, status));

/* calls */
export const addCallNoteAction = async (s: string, id: string, body: string) => act(s, (c) => calls.addCallNote(c, id, { body }));
export const linkCallAction = async (s: string, id: string, input: unknown) => act(s, (c) => calls.linkCall(c, id, input));
export const createTaskFromCallAction = async (s: string, id: string, input: unknown) => act(s, (c) => calls.createTaskFromCall(c, id, input));
export const createTicketFromCallAction = async (s: string, id: string, input: unknown) => act(s, (c) => calls.createTicketFromCall(c, id, input));

/* voicemail */
export const updateVoicemailAction = async (s: string, id: string, input: unknown) => act(s, (c) => calls.updateVoicemail(c, id, input));
export const deleteVoicemailAction = async (s: string, id: string) => act(s, (c) => calls.deleteVoicemail(c, id));

/* admin */
export const enablePhoneAction = async (s: string) => act(s, (c) => acct.enablePhone(c));
export const updatePhoneSettingsAction = async (s: string, input: unknown) => act(s, (c) => acct.updatePhoneSettings(c, input));
export const searchNumbersAction = async (s: string, input: unknown) => act(s, (c) => acct.searchNumbers(c, input), false);
export const purchaseNumberAction = async (s: string, input: unknown) => act(s, (c) => acct.purchaseNumber(c, input));
export const releaseNumberAction = async (s: string, id: string) => act(s, (c) => acct.releasePhoneNumber(c, id));
export const updateNumberAction = async (s: string, id: string, input: unknown) => act(s, (c) => acct.updateNumber(c, id, input));
export const saveQueueAction = async (s: string, id: string | null, input: unknown) => act(s, (c) => acct.saveQueue(c, id, input));
export const archiveQueueAction = async (s: string, id: string) => act(s, (c) => acct.archiveQueue(c, id));
