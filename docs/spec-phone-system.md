CLAUDE CODE — COMPLETE NATIVE CRM PHONE SYSTEM

PROJECT OBJECTIVE

Extend the existing multi-tenant E-Commerce and Social Commerce CRM with a fully integrated business telephone system.

The phone system must allow subscribed businesses to provision phone numbers, make and receive calls, manage departments, route calls, transfer calls, access voicemail, log activities, and link phone interactions to existing customers, leads, orders, support tickets, sales scripts, and support guides.

Build a real, production-oriented communications module using a supported telecommunications API provider.

Use Twilio as the initial provider, but design a reusable provider interface so Telnyx or other supported providers may be integrated later.

Do not build a separate CRM, customer database, ticketing database, or scripting system.

1. NAVIGATION

Add a PHONE & CALLS section:

* Phone Dashboard
* Dialer
* Call History
* Voicemails
* Call Queues
* Phone Numbers
* IVR & Call Routing
* Phone Reports
* Phone Settings

Add a persistent softphone component accessible throughout authorized CRM pages.

2. PHONE DASHBOARD

Display:

* Total Calls
* Inbound Calls
* Outbound Calls
* Missed Calls
* Unanswered Calls
* Voicemails
* Average Call Duration
* Average Wait Time
* Answer Rate
* Calls by Department
* Calls by Agent
* Active Calls
* Call Usage

Allow filters by team, agent, phone number, date, direction, and call outcome.

All dashboards must use actual call records and provider-confirmed call events.

3. WEB SOFTPHONE

Build a responsive softphone using Twilio’s supported Voice JavaScript SDK.

Support:

* Dial pad
* Inbound call notification
* Answer
* Reject
* Hang up
* Mute
* Unmute
* Keypad during calls
* Hold and resume where supported
* Attended or blind transfer where supported
* Call timer
* Caller identity
* Call status
* Audio device selection
* Network and microphone permission errors

Issue short-lived access tokens from a secured server endpoint.

Never expose Twilio account secrets to the browser.

Do not treat browser connectivity as proof that a PSTN call was successfully established.

4. PHONE NUMBER MANAGEMENT

Create a number management interface supporting:

* Search available numbers
* Country selection
* Area code selection
* Number capability display
* Number purchase
* Number assignment
* Department association
* Number status
* Number release
* Eligible porting requests
* Provisioning error history

Start with US local numbers.

Only enable supported number types and regions after validating regulatory requirements.

Create a phone number record connected to the organization and provider account.

Prevent cross-organization number assignment.

5. MULTI-TENANT TELECOM STRUCTURE

Support Twilio subaccounts per merchant.

Store:

* Organization ID
* Provider
* Provider account identifier
* Account connection status
* Provisioned numbers
* Provider resource identifiers
* Usage records
* Billing status

Use secure server-side credentials and appropriate provider account permissions.

Subaccount resources and usage must be isolated by merchant.

Maintain fraud prevention and spend-limit controls.

6. INBOUND CALLS

When an inbound call arrives:

1. Verify the incoming webhook.
2. Identify the associated merchant number.
3. Load that merchant’s active routing configuration.
4. Apply business-hour and holiday rules.
5. Identify the caller using authorized customer identity matching.
6. Start the appropriate routing workflow.
7. Deliver the call to an available agent or queue.
8. Record lifecycle events.
9. Show the customer context to the answering agent.
10. Save the final call outcome.

If the customer is unknown, show an Unknown Caller profile and allow authorized contact creation or linking.

Do not automatically merge uncertain customer identities.

7. OUTBOUND CALLS

Enable outbound calling from:

* Global dialer
* Customer profile
* Lead detail
* Support ticket
* Order detail
* Call history

Clicking a customer phone number should display an authorized Call action.

Validate the destination, agent permission, provider capability, account balance, and configured dialing restrictions before initiating the call.

Use provider-approved caller identity.

Implement configurable international calling restrictions and fraud protections.

8. INTERACTIVE VOICE RESPONSE

Create a visual IVR editor.

Supported nodes:

* Incoming Call
* Play Greeting
* Text-to-Speech Greeting
* Collect Keypad Input
* Route to Department
* Route to Agent
* Queue
* Business Hours
* Holiday Check
* Conditional Branch
* Voicemail
* Transfer
* End Call

Allow businesses to:

* Add nodes
* Move nodes
* Connect nodes
* Edit settings
* Save draft
* Preview configuration
* Validate flow
* Publish
* Roll back to previous version

Prevent loops and unreachable routing branches.

Do not activate invalid flows.

9. CALL QUEUES

Support:

* Sales Queue
* Support Queue
* Orders Queue
* Custom Queues

Routing methods:

* Simultaneous ringing
* Round-robin
* Sequential
* Least active calls
* Priority-based
* Assigned customer owner where applicable

Queue settings:

* Maximum wait time
* Queue capacity
* Business hours
* Music on hold
* Overflow destination
* Unanswered call handling
* Voicemail fallback
* Callback request

Handle disconnected agents and call routing failures safely.

10. TEAM AVAILABILITY

Allow employees to set:

* Available
* Busy
* Away
* Offline
* Do Not Disturb

Automatically update call availability during active calls where supported.

Allow administrators to configure agent capacity and eligible queues.

Do not route calls to agents without required organization access.

11. VOICEMAIL

Support:

* Voicemail recording
* Voicemail notification
* Customer matching
* Playback for authorized users
* Callback task creation
* Assign voicemail
* Mark reviewed
* Archive
* Delete according to retention policy

Implement recording notice and consent where required.

12. CALL HISTORY

Create a complete call log.

Fields:

* Call ID
* Provider Call ID
* Organization
* Direction
* From Number
* To Number
* Business Number
* Customer
* Assigned Agent
* Queue
* Start Time
* Answer Time
* End Time
* Duration
* Status
* Outcome
* Related Lead
* Related Order
* Related Ticket
* Recording Reference
* Notes
* Provider Usage
* Billing Amount

Use a canonical call record and distinguish individual call legs from the overall customer interaction.

Handle repeated or out-of-order provider events safely.

13. CALL DETAIL

Provide:

* Customer summary
* Direction and timestamps
* Duration
* Agent
* Call outcome
* Call leg history
* Call notes
* Related CRM records
* Authorized recording playback
* Related tasks
* Activity history

Actions:

* Call Back
* Add Note
* Create Task
* Create Lead
* Create Ticket
* Link Order
* Change Outcome
* Assign Follow-Up

14. CRM CUSTOMER INTEGRATION

Every identified call should appear in the customer’s unified activity timeline.

Allow calls to be linked to:

* Customers
* Leads
* Orders
* Support Tickets
* Tasks

Use canonical CRM records.

Do not duplicate customer profiles or existing sales opportunities.

15. SALES SCRIPTS

Integrate the existing Playbooks & Knowledge Center.

During calls, allow agents to:

* Search sales scripts
* View recommended scripts
* Filter scripts by pipeline stage
* Display approved talking points
* Add call notes
* Schedule follow-up actions

Do not overwrite scripts or source customer records during calls.

16. SUPPORT GUIDES

When a call relates to a support issue:

* Display relevant support guides.
* Allow agents to launch ticket checklists.
* Show related orders.
* Create or link support tickets.
* Record guide progress against the ticket.
* Escalate when required.

Maintain existing support permissions and required resolution steps.

17. RECORDINGS

Support optional call recording.

Recording configuration must include:

* Organization policy
* Supported jurisdiction restrictions
* Consent/notice workflow
* Recording on/off
* Retention period
* Access permissions
* Secure playback
* Deletion
* Audit logging

Do not enable automatic recording without an approved compliance configuration.

Record consent evidence as required.

Use private storage and short-lived authorized access URLs.

18. CALL AUTOMATIONS

Extend the common CRM automation engine.

Triggers:

* Incoming Call
* Missed Call
* Call Completed
* Voicemail Received
* Call Assigned
* Queue Wait Threshold Reached
* Call Outcome Updated

Actions:

* Create Task
* Notify Agent
* Assign Lead
* Create Ticket
* Add Activity
* Request Callback
* Send Authorized Follow-Up Message

Respect messaging consent and platform policies.

Use durable, idempotent event processing.

19. PHONE ANALYTICS

Build reports for:

* Call volume
* Call direction
* Answer rate
* Missed calls
* Queue wait
* Agent performance
* Call outcomes
* Average duration
* Voicemail volume
* Calls associated with leads
* Calls associated with tickets
* Usage cost by merchant

Provide filters by date, agent, queue, and business number.

Separate unique calls, call attempts, and billable call legs.

20. PHONE BILLING

Create an optional Phone Add-on system.

Support:

* Number subscription charges
* Inbound usage
* Outbound usage
* Browser call legs
* Recordings
* Transcription
* Additional features
* Provider taxes and fees
* Usage metering
* Spend alerts
* Account suspension safeguards

Do not hardcode telecom prices.

Maintain configurable provider rates, effective dates, markup rules, and merchant charges.

Do not promise unlimited usage without defined financial and abuse controls.

21. DATA MODEL

Create or extend:

* telecom_accounts
* phone_numbers
* phone_agents
* phone_queues
* phone_queue_members
* phone_availability
* ivr_flows
* ivr_flow_versions
* call_routing_rules
* calls
* call_legs
* call_events
* call_recordings
* call_voicemails
* call_notes
* call_record_links
* call_outcomes
* phone_usage_records
* phone_billing_records
* phone_settings

Enforce tenant isolation and data integrity.

Use unique external provider identifiers and event idempotency keys.

22. SECURITY & COMPLIANCE

Implement:

* Webhook signature verification
* Authorization on all calling operations
* Secure access tokens
* Secret rotation procedures
* Recording permissions
* Consent controls
* Caller ID restrictions
* International dialing restrictions
* Anti-fraud limits
* Rate limiting
* Call spending alerts
* Sensitive data protection
* Regulatory setup workflows
* Audit history
* Emergency calling limitations and applicable provider requirements

Do not activate unsupported emergency calling scenarios.

Obtain appropriate legal and telecom review before enabling regulated capabilities.

23. TESTING

Test:

* Number provisioning
* Number ownership isolation
* Inbound call routing
* Outbound call initiation
* Browser microphone failures
* Agent offline handling
* Busy agents
* No-answer fallback
* IVR input
* Queue overflow
* Voicemail
* Transfers
* Duplicate provider webhooks
* Out-of-order events
* Customer matching
* Ticket creation
* Recording access control
* Billing reconciliation
* Cross-tenant restrictions

Use provider test environments, mocks, and explicit real-world test cases.

Never represent mocked calls as real completed calls.

24. IMPLEMENTATION SEQUENCE

Phase 1 — Provider integration and database foundation

Phase 2 — Number provisioning and phone settings

Phase 3 — Browser softphone and outbound calling

Phase 4 — Inbound calling and CRM customer matching

Phase 5 — Call logs, notes, and related records

Phase 6 — Queues, IVR, routing, and voicemail

Phase 7 — Support tickets, sales scripts, and support guides integration

Phase 8 — Recordings and compliance controls

Phase 9 — Usage billing, analytics, fraud protection, and production hardening

Implement each phase with functional frontend, backend, persistence, authorization, tests, and documentation.

Do not declare the system complete until actual call flows have been tested using approved provider accounts.

Preserve the entire existing CRM architecture.