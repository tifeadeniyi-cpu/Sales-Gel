import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signatureFor, twiml, verifySignature, voiceAccessToken } from "@/domains/phone/twilio";
import { checkDestination } from "@/domains/phone/dialing";

describe("Twilio webhook signatures", () => {
  it("follows Twilio's documented construction", () => {
    // Twilio's security docs: URL with query string, then each POST param name+value sorted by name, HMAC-SHA1 with the auth token, base64.
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = { To: "+18005551212", Digits: "1234", From: "+14158675310", CallSid: "CA1234567890ABCDE", Caller: "+14158675310" };
    const documented = "https://mycompany.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212";
    const expected = createHmac("sha1", "12345").update(documented).digest("base64");
    expect(signatureFor("12345", url, params)).toBe(expected);
    expect(verifySignature("12345", url, params, expected)).toBe(true);
    expect(verifySignature("12345", url, { ...params, Digits: "9" }, expected)).toBe(false);
    expect(verifySignature("12345", url, params, null)).toBe(false);
  });
});

describe("Voice access tokens", () => {
  it("are HS256 JWTs with the voice grant and a short expiry", () => {
    const t = voiceAccessToken({ accountSid: "AC" + "a".repeat(32), apiKeySid: "SK" + "b".repeat(32), apiKeySecret: "shh", identity: "m123", appSid: "AP" + "c".repeat(32), ttlSec: 600, now: 1_700_000_000_000 });
    const [h, p, sig] = t.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({ iss: "SK" + "b".repeat(32), sub: "AC" + "a".repeat(32), exp: 1_700_000_600, grants: { identity: "m123", voice: { incoming: { allow: true }, outgoing: { application_sid: "AP" + "c".repeat(32) } } } });
    expect(sig).toBe(createHmac("sha256", "shh").update(`${h}.${p}`).digest("base64url"));
  });
});

describe("TwiML", () => {
  it("escapes text and attributes", () => {
    expect(twiml.doc(twiml.say(`Tom & "Jerry" <hi>`), twiml.dial({ callerId: "+15550100", answerOnBridge: true, record: false }, twiml.number({}, "+15550199"))))
      .toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Tom &amp; &quot;Jerry&quot; &lt;hi&gt;</Say><Dial callerId="+15550100" answerOnBridge="true"><Number>+15550199</Number></Dial></Response>');
    expect(twiml.client({}, "m1", { callId: "x&y" })).toBe('<Client><Identity>m1</Identity><Parameter name="callId" value="x&amp;y"/></Client>');
  });
});

describe("dialing restrictions", () => {
  const s = { allowedCountries: ["US", "CA"], blockPremium: true };
  it("normalizes and allows ordinary numbers in allowed countries", () => {
    expect(checkDestination("(214) 555-0182", s)).toEqual({ ok: true, e164: "+12145550182", country: "US" });
    expect(checkDestination("+1 416 555 0123", s)).toMatchObject({ ok: true, country: "CA" });
  });
  it("blocks emergency, premium, disallowed countries and junk", () => {
    expect(checkDestination("911", s)).toMatchObject({ ok: false, reason: expect.stringMatching(/emergency/i) });
    expect(checkDestination("+1 900 555 0100", s)).toMatchObject({ ok: false, reason: expect.stringMatching(/premium/i) });
    expect(checkDestination("+44 20 7946 0958", s)).toMatchObject({ ok: false, reason: expect.stringMatching(/GB/) });
    expect(checkDestination("+234 803 123 4567", { ...s, allowedCountries: ["US", "NG"] })).toMatchObject({ ok: true, country: "NG" });
    expect(checkDestination("hello", s)).toMatchObject({ ok: false });
  });
});
