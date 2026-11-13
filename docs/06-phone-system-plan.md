# Phone & Calls Module: Plan

> **Status (Phase 8b):** P1–P6 core is built (see PROGRESS.md). Code lives in `src/domains/phone/` (`twilio.ts` HTTP/TwiML/tokens, `account.ts` setup, `voice.ts` webhooks and routing, `calls.ts` history/voicemail/stats, `dialing.ts` restrictions); webhooks at `/api/telephony/[accountId]/[voice|status|dial-result|recording|voicemail-done]`. Deferred: IVR editor (Phase 9), call recording (consent decision), scripts (Phase 10), usage billing (Phase 11).

Source spec: [spec-phone-system.md](spec-phone-system.md). It extends the CRM; it doesn't duplicate customers, leads, tickets or scripts.

## Where it fits in the roadmap

The phone module links calls to customers, leads, **orders** and **support tickets**, shows **sales scripts / support guides**, and extends the **automation engine** and **usage billing**. It has to land after those exist:

| Phone phase | Depends on CRM phase |
|---|---|
| P1 Provider integration + data model | 6 (integration framework, webhooks, job queue) |
| P2 Number provisioning + settings | P1; Twilio account + regulatory bundle |
| P3 Browser softphone + outbound | P2; Twilio Voice JS SDK, TwiML app, API key |
| P4 Inbound + customer matching | P3; Customers (done) |
| P5 Call logs, notes, related records | P4; Orders (4), Tickets (5) |
| P6 Queues, IVR, routing, voicemail | P5; object storage for voicemail |
| P7 Tickets, scripts, guides | Support (5, 7), Knowledge Base (10) |
| P8 Recordings + compliance | P6; legal review of consent rules per state |
| P9 Usage billing, analytics, fraud | Billing (11) |

**Confirmed slot: right after CRM Phase 8 (Unified Inbox)**, which builds the shared conversation/channel and webhook plumbing that calls reuse. Phone P1–P4 can start right after CRM Phase 6 if calling is a priority.

## Design commitments (from the spec)

- Provider interface (`TelephonyProvider`) with a Twilio adapter first; Telnyx later.
- One Twilio **subaccount per organization**; `telecom_accounts` stores the subaccount SID; credentials encrypted server-side.
- Short-lived Voice access tokens from an authenticated endpoint; no account secrets in the browser.
- Canonical `calls` plus `call_legs` and `call_events` with a unique `(provider, provider_event_id)` idempotency key; out-of-order events are reconciled by provider timestamp and status precedence.
- Webhook signature verification on every Twilio callback.
- Dialing restrictions (country allow-list, premium-rate block), spend limits and alerts before any outbound call.
- Recording is **off by default** and can only be enabled after a compliance configuration (notice/consent) is saved.
- No emergency (911) calling from the softphone until provider E911 requirements are met.
- Mocked provider responses exist only in tests; the UI never shows a simulated call as completed.

## What you'll need to provide

- A Twilio account (upgraded from trial for real customer calls), with permission to create subaccounts.
- A US A2P/regulatory profile for the numbers you'll buy (business name, EIN, address).
- A decision on call recording (which states your customers are in; two-party consent states need an announcement).
