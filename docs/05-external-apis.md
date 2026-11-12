# External API Requirements

Each provider is built as an adapter behind a common interface (`authorize`, `exchange`, `refresh`, `verifyWebhook`, `sync*`). Until real credentials are configured, its status is **Not connected** in the UI, and nothing simulates it.

| Provider | Phase | Auth | What you need to supply | Approval / review |
|---|---|---|---|---|
| Email (transactional: invites, notifications) | 1→2 | API key | A provider account (e.g. Resend, Postmark or SES) plus a verified sending domain | Domain DNS (SPF/DKIM) |
| S3-compatible storage | 2 | Access key | Bucket, region, keys (AWS S3, Cloudflare R2 or Neon Object Storage) | — |
| Shopify | 6 | OAuth (Partner app) | Shopify Partner account, app client id/secret, a dev store | Public distribution requires app review; custom/unlisted apps don't |
| Stripe (merchant payments) | 6 | Connect OAuth or restricted keys | Stripe account; webhook signing secret | — |
| Stripe (SaaS billing) | 11 | Secret key | Products and prices for the plans; webhook secret | — |
| Gmail | 8 | Google OAuth | GCP project, OAuth client, consent screen | Restricted Gmail scopes require Google verification and a security assessment for production |
| Microsoft Outlook | 8 | Microsoft identity platform | Entra app registration | Publisher verification recommended |
| Instagram / Messenger | 8 | Meta login | Meta Business, a Meta app, and a Page/IG professional account | Meta App Review for messaging permissions; 24-hour messaging window rules |
| WhatsApp Business Platform | 8 | Meta (Cloud API) | WABA, phone number, message templates | Business verification; template approval; per-conversation pricing |
| WooCommerce | 6+ | REST keys | Store URL plus consumer key/secret | — |
| Paystack / Flutterwave | 6+ | Secret keys | Merchant accounts; webhook secrets | — |
| QuickBooks, Xero, calendars, Zapier, Make | later | OAuth | Developer apps | Varies |

Provider requirements (API versions, scopes, messaging windows) are re-verified against current official documentation when each phase begins, because they change.
