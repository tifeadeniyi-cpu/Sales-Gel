import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/crypto";

/**
 * Twilio REST, webhook signatures, Voice access tokens and TwiML — written directly against the
 * documented HTTP interfaces (no SDK on the server). The platform account (env) only creates
 * subaccounts; everything a workspace does runs with its own subaccount credentials.
 */
const API = "https://api.twilio.com/2010-04-01";

export class TwilioError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

export function platformCredentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token && /^AC[0-9a-f]{32}$/i.test(sid) ? { sid, token } : null;
}

type Auth = { sid: string; token: string };

async function req<T>(auth: Auth, method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string | undefined>): Promise<T> {
  const body = form ? new URLSearchParams(Object.entries(form).filter((e): e is [string, string] => e[1] !== undefined)).toString() : undefined;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${Buffer.from(`${auth.sid}:${auth.token}`).toString("base64")}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new TwilioError("Twilio couldn't be reached. Try again.", 503);
  }
  if (res.status === 204) return {} as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new TwilioError(String(json.message ?? `Twilio returned ${res.status}`), res.status, json.code as number | undefined);
  return json as T;
}

/* ───────── subaccount setup ───────── */

export async function createSubaccount(platform: Auth, friendlyName: string) {
  return req<{ sid: string; auth_token: string; status: string }>(platform, "POST", "/Accounts.json", { FriendlyName: friendlyName.slice(0, 64) });
}
export async function closeSubaccount(platform: Auth, sid: string) {
  return req(platform, "POST", `/Accounts/${sid}.json`, { Status: "closed" });
}
export async function createApiKey(sub: Auth, name: string) {
  return req<{ sid: string; secret: string }>(sub, "POST", `/Accounts/${sub.sid}/Keys.json`, { FriendlyName: name });
}
export async function createTwimlApp(sub: Auth, name: string, voiceUrl: string, statusUrl: string) {
  return req<{ sid: string }>(sub, "POST", `/Accounts/${sub.sid}/Applications.json`, { FriendlyName: name, VoiceUrl: voiceUrl, VoiceMethod: "POST", StatusCallback: statusUrl, StatusCallbackMethod: "POST" });
}

/* ───────── numbers ───────── */

export interface AvailableNumber { phone_number: string; friendly_name: string; locality: string | null; region: string | null; capabilities: { voice: boolean; SMS: boolean; MMS: boolean } }

export async function searchLocalNumbers(sub: Auth, q: { areaCode?: string; contains?: string; country?: string }) {
  const params = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
  if (q.areaCode) params.set("AreaCode", q.areaCode);
  if (q.contains) params.set("Contains", q.contains);
  const r = await req<{ available_phone_numbers: AvailableNumber[] }>(sub, "GET", `/Accounts/${sub.sid}/AvailablePhoneNumbers/${q.country ?? "US"}/Local.json?${params}`);
  return r.available_phone_numbers;
}

export async function buyNumber(sub: Auth, e164: string, voiceUrl: string, statusUrl: string) {
  return req<{ sid: string; phone_number: string; friendly_name: string; capabilities: { voice: boolean; sms: boolean; mms: boolean } }>(sub, "POST", `/Accounts/${sub.sid}/IncomingPhoneNumbers.json`, {
    PhoneNumber: e164, VoiceUrl: voiceUrl, VoiceMethod: "POST", StatusCallback: statusUrl, StatusCallbackMethod: "POST",
  });
}
export async function releaseNumber(sub: Auth, numberSid: string) {
  return req(sub, "DELETE", `/Accounts/${sub.sid}/IncomingPhoneNumbers/${numberSid}.json`);
}

/* ───────── calls & recordings ───────── */

export async function fetchCall(sub: Auth, callSid: string) {
  return req<{ sid: string; price: string | null; price_unit: string | null; status: string; duration: string | null; direction: string; start_time: string | null }>(sub, "GET", `/Accounts/${sub.sid}/Calls/${callSid}.json`);
}
/** Child legs of a parent call (each <Dial> target). */
export async function listChildCalls(sub: Auth, parentSid: string) {
  const r = await req<{ calls: { sid: string; price: string | null; price_unit: string | null; status: string; direction: string; start_time: string | null }[] }>(sub, "GET", `/Accounts/${sub.sid}/Calls.json?ParentCallSid=${parentSid}&PageSize=50`);
  return r.calls;
}
/** Streams a recording's audio with the subaccount's credentials (never exposed to the browser). */
export async function fetchRecordingAudio(sub: Auth, recordingSid: string) {
  const res = await fetch(`${API}/Accounts/${sub.sid}/Recordings/${recordingSid}.mp3`, { headers: { Authorization: `Basic ${Buffer.from(`${sub.sid}:${sub.token}`).toString("base64")}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new TwilioError("Recording unavailable", res.status);
  return Buffer.from(await res.arrayBuffer());
}
export async function deleteRecording(sub: Auth, recordingSid: string) {
  return req(sub, "DELETE", `/Accounts/${sub.sid}/Recordings/${recordingSid}.json`);
}

/* ───────── webhooks ───────── */

/**
 * X-Twilio-Signature: base64 HMAC-SHA1 (auth token) of the full URL followed by each POST
 * parameter name and value, sorted by name.
 */
export function signatureFor(authToken: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}
export function verifySignature(authToken: string, url: string, params: Record<string, string>, header: string | null) {
  return !!header && safeEqual(signatureFor(authToken, url, params), header);
}

/* ───────── access tokens ───────── */

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Short-lived Voice access token (HS256 with the subaccount API key secret). */
export function voiceAccessToken(o: { accountSid: string; apiKeySid: string; apiKeySecret: string; identity: string; appSid: string; ttlSec?: number; now?: number }) {
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${o.apiKeySid}-${now}`, iss: o.apiKeySid, sub: o.accountSid, iat: now, nbf: now, exp: now + (o.ttlSec ?? 3600),
    grants: { identity: o.identity, voice: { incoming: { allow: true }, outgoing: { application_sid: o.appSid } } },
  };
  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  return `${unsigned}.${createHmac("sha256", o.apiKeySecret).update(unsigned).digest("base64url")}`;
}

/* ───────── TwiML ───────── */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
type Attrs = Record<string, string | number | boolean | undefined | null>;
const attrs = (a: Attrs) => Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join("");

export const twiml = {
  doc: (...verbs: string[]) => `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join("")}</Response>`,
  say: (text: string) => `<Say voice="Polly.Joanna">${esc(text)}</Say>`,
  hangup: () => "<Hangup/>",
  pause: (sec: number) => `<Pause length="${sec}"/>`,
  dial: (a: Attrs, ...nouns: string[]) => `<Dial${attrs(a)}>${nouns.join("")}</Dial>`,
  number: (a: Attrs, e164: string) => `<Number${attrs(a)}>${esc(e164)}</Number>`,
  client: (a: Attrs, identity: string, params: Record<string, string> = {}) =>
    `<Client${attrs(a)}><Identity>${esc(identity)}</Identity>${Object.entries(params).map(([n, v]) => `<Parameter name="${esc(n)}" value="${esc(v)}"/>`).join("")}</Client>`,
  record: (a: Attrs) => `<Record${attrs(a)}/>`,
  redirect: (url: string) => `<Redirect method="POST">${esc(url)}</Redirect>`,
};
