"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/server/actions";
import { requireOrgContext } from "@/server/authz/request";
import * as svc from "@/domains/inbox/service";
import * as conn from "@/domains/inbox/connections";

type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;
async function act<T>(orgSlug: string, fn: (ctx: Ctx) => Promise<T>) {
  const ctx = await requireOrgContext(orgSlug);
  const res = await runAction(() => fn(ctx));
  if (res.ok) revalidatePath(`/o/${orgSlug}`, "layout");
  return res;
}

export const sendReplyAction = async (s: string, id: string, body: string) => act(s, (c) => svc.sendReply(c, id, { body }));
export const addNoteAction = async (s: string, id: string, body: string) => act(s, (c) => svc.addNote(c, id, { body }));
export const retryMessageAction = async (s: string, messageId: string) => act(s, (c) => svc.retryMessage(c, messageId));
export const assignConversationAction = async (s: string, id: string, membershipId: string | null) => act(s, (c) => svc.assignConversation(c, id, membershipId));
export const setConversationStatusAction = async (s: string, id: string, status: "open" | "pending" | "closed") => act(s, (c) => svc.setConversationStatus(c, id, status));
export const linkCustomerAction = async (s: string, id: string, customerId: string | null) => act(s, (c) => svc.linkConversationCustomer(c, id, customerId));
export const createCustomerAction = async (s: string, id: string) => act(s, (c) => svc.createCustomerFromConversation(c, id));
export const convertToTicketAction = async (s: string, id: string) => act(s, (c) => svc.convertToTicket(c, id));
export const createSavedReplyAction = async (s: string, input: unknown) => act(s, (c) => svc.createSavedReply(c, input));
export const archiveSavedReplyAction = async (s: string, id: string) => act(s, (c) => svc.archiveSavedReply(c, id));
export const connectWebchatAction = async (s: string, input: unknown) => act(s, (c) => conn.connectWebchat(c, input));
export const updateWebchatAction = async (s: string, id: string, input: unknown) => act(s, (c) => conn.updateWebchat(c, id, input));
export const connectEmailAction = async (s: string, input: unknown) => act(s, (c) => conn.connectEmail(c, input));
export const connectWhatsAppAction = async (s: string, input: unknown) => act(s, (c) => conn.connectWhatsApp(c, input));
export const connectMessengerAction = async (s: string, input: unknown) => act(s, (c) => conn.connectMessenger(c, input));
export const connectInstagramAction = async (s: string, input: unknown) => act(s, (c) => conn.connectInstagram(c, input));
export const disconnectChannelAction = async (s: string, id: string) => act(s, (c) => conn.disconnectChannel(c, id));
