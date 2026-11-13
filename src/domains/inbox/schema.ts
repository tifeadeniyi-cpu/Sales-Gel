import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { memberships, organizations, teams } from "@/domains/identity/schema";
import { customers } from "@/domains/customers/schema";
import { files, supportTickets } from "@/domains/support/schema";
import { user } from "@/server/auth/schema";
import { createdAt, id, organizationId, tsz, updatedAt } from "@/server/db/columns";

const orgFk = (name: string, t: { organizationId: AnyPgColumn }) =>
  foreignKey({ name, columns: [t.organizationId], foreignColumns: [organizations.id] }).onDelete("cascade");

export const CHANNELS = ["webchat", "email", "whatsapp", "messenger", "instagram"] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * A connected messaging channel. Credentials are AES-GCM encrypted (`v1:` envelope); the public key
 * identifies a web chat widget; webhooks reach `/api/webhooks/inbox/<id>` and are routed through
 * integration_routes before any tenant data is read.
 */
export const channelConnections = pgTable(
  "channel_connections",
  {
    id: id(),
    organizationId: organizationId(),
    channel: text("channel").$type<Channel>().notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    externalAccountId: text("external_account_id"),
    credentials: text("credentials"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    publicKey: text("public_key"),
    lastError: text("last_error"),
    lastInboundAt: tsz("last_inbound_at"),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    disconnectedAt: tsz("disconnected_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("channel_connections_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("channel_connections_public_key_uq").on(t.publicKey).where(sql`${t.publicKey} is not null`),
    orgFk("channel_connections_org_fk", t),
    check("channel_connections_channel_chk", sql`${t.channel} in ('webchat','email','whatsapp','messenger','instagram')`),
    check("channel_connections_status_chk", sql`${t.status} in ('active','error','disconnected')`),
  ],
);

export const CONVERSATION_STATUSES = ["open", "pending", "closed"] as const;

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    organizationId: organizationId(),
    number: integer("number").notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    connectionId: uuid("connection_id").notNull(),
    customerId: uuid("customer_id"),
    /** Who we talk to on this channel: email address, WhatsApp number, PSID/IGSID, or web visitor id. */
    contactHandle: text("contact_handle").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    subject: text("subject"),
    status: text("status").notNull().default("open"),
    assigneeMembershipId: uuid("assignee_membership_id"),
    teamId: uuid("team_id"),
    ticketId: uuid("ticket_id"),
    lastMessageAt: tsz("last_message_at").notNull().defaultNow(),
    lastInboundAt: tsz("last_inbound_at"),
    lastOutboundAt: tsz("last_outbound_at"),
    lastPreview: text("last_preview"),
    /** WhatsApp / Messenger / Instagram: free-form replies are allowed until this time (24h after the last inbound). */
    windowExpiresAt: tsz("window_expires_at"),
    /** Email thread anchor (Message-ID of the first message) so replies thread in the customer's mail app. */
    threadKey: text("thread_key"),
    /** Web chat visitor session (SHA-256 of the secret held by the visitor's browser). */
    visitorTokenHash: text("visitor_token_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("conversations_org_id_uq").on(t.organizationId, t.id),
    unique("conversations_number_uq").on(t.organizationId, t.number),
    index("conversations_queue_idx").on(t.organizationId, t.status, t.lastMessageAt),
    index("conversations_assignee_idx").on(t.organizationId, t.assigneeMembershipId),
    index("conversations_contact_idx").on(t.organizationId, t.connectionId, t.contactHandle),
    index("conversations_customer_idx").on(t.organizationId, t.customerId),
    uniqueIndex("conversations_visitor_uq").on(t.visitorTokenHash).where(sql`${t.visitorTokenHash} is not null`),
    orgFk("conversations_org_fk", t),
    foreignKey({ name: "conversations_connection_fk", columns: [t.organizationId, t.connectionId], foreignColumns: [channelConnections.organizationId, channelConnections.id] }),
    foreignKey({ name: "conversations_customer_fk", columns: [t.organizationId, t.customerId], foreignColumns: [customers.organizationId, customers.id] }),
    foreignKey({ name: "conversations_assignee_fk", columns: [t.organizationId, t.assigneeMembershipId], foreignColumns: [memberships.organizationId, memberships.id] }),
    foreignKey({ name: "conversations_team_fk", columns: [t.organizationId, t.teamId], foreignColumns: [teams.organizationId, teams.id] }),
    foreignKey({ name: "conversations_ticket_fk", columns: [t.organizationId, t.ticketId], foreignColumns: [supportTickets.organizationId, supportTickets.id] }),
    check("conversations_status_chk", sql`${t.status} in ('open','pending','closed')`),
  ],
);

export const MESSAGE_DIRECTIONS = ["inbound", "outbound", "note"] as const;
export const DELIVERY = ["received", "queued", "sent", "delivered", "read", "failed"] as const;

/** Append-only conversation history; only delivery fields change after insert. */
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: id(),
    organizationId: organizationId(),
    conversationId: uuid("conversation_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    direction: text("direction").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    providerMessageId: text("provider_message_id"),
    deliveryStatus: text("delivery_status").notNull(),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: tsz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversation_messages_org_id_uq").on(t.organizationId, t.id),
    index("conversation_messages_conv_idx").on(t.organizationId, t.conversationId, t.createdAt),
    uniqueIndex("conversation_messages_provider_uq").on(t.connectionId, t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
    foreignKey({ name: "conversation_messages_conv_fk", columns: [t.organizationId, t.conversationId], foreignColumns: [conversations.organizationId, conversations.id] }).onDelete("cascade"),
    check("conversation_messages_direction_chk", sql`${t.direction} in ('inbound','outbound','note')`),
    check("conversation_messages_delivery_chk", sql`${t.deliveryStatus} in ('received','queued','sent','delivered','read','failed')`),
    check("conversation_messages_body_chk", sql`length(${t.body}) between 1 and 50000`),
  ],
);

export const conversationAttachments = pgTable(
  "conversation_attachments",
  {
    id: id(),
    organizationId: organizationId(),
    messageId: uuid("message_id").notNull(),
    fileId: uuid("file_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversation_attachments_org_id_uq").on(t.organizationId, t.id),
    index("conversation_attachments_msg_idx").on(t.organizationId, t.messageId),
    foreignKey({ name: "conversation_attachments_msg_fk", columns: [t.organizationId, t.messageId], foreignColumns: [conversationMessages.organizationId, conversationMessages.id] }).onDelete("cascade"),
    foreignKey({ name: "conversation_attachments_file_fk", columns: [t.organizationId, t.fileId], foreignColumns: [files.organizationId, files.id] }),
  ],
);

/** Per-person read position, for unread badges. */
export const conversationReads = pgTable(
  "conversation_reads",
  {
    organizationId: organizationId(),
    conversationId: uuid("conversation_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    lastReadAt: tsz("last_read_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "conversation_reads_pk", columns: [t.conversationId, t.membershipId] }),
    foreignKey({ name: "conversation_reads_conv_fk", columns: [t.organizationId, t.conversationId], foreignColumns: [conversations.organizationId, conversations.id] }).onDelete("cascade"),
    foreignKey({ name: "conversation_reads_member_fk", columns: [t.organizationId, t.membershipId], foreignColumns: [memberships.organizationId, memberships.id] }).onDelete("cascade"),
  ],
);

export const savedReplies = pgTable(
  "saved_replies",
  {
    id: id(),
    organizationId: organizationId(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    archivedAt: tsz("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("saved_replies_org_id_uq").on(t.organizationId, t.id),
    uniqueIndex("saved_replies_title_uq").on(t.organizationId, sql`lower(${t.title})`).where(sql`${t.archivedAt} is null`),
    orgFk("saved_replies_org_fk", t),
    check("saved_replies_body_chk", sql`length(${t.body}) between 1 and 5000`),
  ],
);
