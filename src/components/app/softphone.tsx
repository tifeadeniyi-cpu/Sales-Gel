"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Grid3x3, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, X } from "lucide-react";
import type { Call, Device } from "@twilio/voice-sdk";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { activeCallInfoAction, prepareCallAction, setAvailabilityAction, voiceTokenAction } from "@/app/(app)/o/[orgSlug]/phone/actions";

type Status = "available" | "busy" | "away" | "offline" | "dnd";
export interface DialRequest { to: string; customerId?: string; leadId?: string; orderId?: string; ticketId?: string; label?: string }
export const DIAL_EVENT = "salesgel:dial";
/** Opens the softphone with a number filled in (click-to-call). The person still presses Call. */
export function requestDial(d: DialRequest) {
  window.dispatchEvent(new CustomEvent<DialRequest>(DIAL_EVENT, { detail: d }));
}

const STATUS_LABEL: Record<Status, string> = { available: "Available", busy: "Busy", away: "Away", dnd: "Do not disturb", offline: "Offline" };
const STATUS_DOT: Record<Status, string> = { available: "bg-success", busy: "bg-danger", away: "bg-warning", dnd: "bg-danger", offline: "bg-inactive" };
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

type Live = { call: Call; direction: "inbound" | "outbound"; other: string; startedAt: number | null; info: { id: string; customerId: string | null; customerName: string | null } | null };

function micMessage(e: { code?: number; message?: string }) {
  if (e.code === 31401 || e.code === 31402 || e.code === 31208 || /permission|NotAllowed/i.test(e.message ?? "")) return "Allow microphone access in your browser to make and take calls.";
  return e.message || "The call couldn't connect.";
}

export function Softphone({ orgSlug, numbers, initialStatus }: { orgSlug: string; numbers: { id: string; e164: string; label: string | null }[]; initialStatus: Status }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [to, setTo] = useState("");
  const [fromId, setFromId] = useState(numbers[0]?.id ?? "");
  const [context, setContext] = useState<Omit<DialRequest, "to">>({});
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [incoming, setIncoming] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [now, setNow] = useState(0);
  const deviceRef = useRef<Device | null>(null);
  const deviceInit = useRef<Promise<Device | null> | null>(null);

  const fetchToken = useCallback(async () => {
    const r = await voiceTokenAction(orgSlug);
    if (!r.ok) throw new Error(r.error);
    return r.data.token;
  }, [orgSlug]);

  const attachCall = useCallback((call: Call, direction: "inbound" | "outbound", other: string) => {
    setLive({ call, direction, other, startedAt: null, info: null });
    setMuted(false);
    setKeypad(false);
    call.on("accept", () => {
      setLive((l) => (l && l.call === call ? { ...l, startedAt: Date.now() } : l));
      const callId = call.customParameters.get("callId");
      const callSid = call.parameters.CallSid;
      if (callId || callSid) void activeCallInfoAction(orgSlug, callId ? { callId } : { callSid }).then((r) => { if (r.ok && r.data) setLive((l) => (l && l.call === call ? { ...l, other: r.data!.other, info: r.data } : l)); });
    });
    call.on("mute", (m: boolean) => setMuted(m));
    const end = () => { setLive((l) => (l && l.call === call ? null : l)); setConnecting(false); };
    call.on("disconnect", end);
    call.on("cancel", end);
    call.on("reject", end);
    call.on("error", (e: { code?: number; message?: string }) => { setError(micMessage(e)); end(); });
  }, [orgSlug]);

  /** Loads the Voice SDK only when needed, so pages stay light for people who never call. */
  const getDevice = useCallback(async () => {
    if (deviceRef.current) return deviceRef.current;
    deviceInit.current ??= (async () => {
      try {
        const { Device: TwilioDevice } = await import("@twilio/voice-sdk");
        const d = new TwilioDevice(await fetchToken(), { closeProtection: "You're on a call. Leaving will hang up.", appName: "SalesGel" });
        d.on("tokenWillExpire", async () => { try { d.updateToken(await fetchToken()); } catch { /* next call will refresh */ } });
        d.on("error", (e: { code?: number; message?: string }) => setError(micMessage(e)));
        d.on("incoming", (call: Call) => {
          setIncoming(call);
          setOpen(true);
          const clear = () => setIncoming((c) => (c === call ? null : c));
          call.on("cancel", clear);
          call.on("disconnect", clear);
          call.on("reject", clear);
        });
        deviceRef.current = d;
        return d;
      } catch (e) {
        setError(e instanceof Error ? e.message : "The phone couldn't start.");
        deviceInit.current = null;
        return null;
      }
    })();
    return deviceInit.current;
  }, [fetchToken]);

  // Incoming calls ring this browser only while the member is Available.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (status === "available") {
        const d = await getDevice();
        if (d && !cancelled && d.state !== "registered") await d.register().catch((e: { code?: number; message?: string }) => setError(micMessage(e)));
      } else if (deviceRef.current?.state === "registered") {
        await deviceRef.current.unregister().catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [status, getDevice]);

  useEffect(() => () => { deviceRef.current?.destroy(); }, []);

  // Click-to-call from customer, lead, order and ticket pages.
  useEffect(() => {
    const onDial = (e: Event) => {
      const d = (e as CustomEvent<DialRequest>).detail;
      if (!d?.to) return;
      setTo(d.to);
      setContext({ customerId: d.customerId, leadId: d.leadId, orderId: d.orderId, ticketId: d.ticketId, label: d.label });
      setError(null);
      setOpen(true);
    };
    window.addEventListener(DIAL_EVENT, onDial);
    return () => window.removeEventListener(DIAL_EVENT, onDial);
  }, []);

  useEffect(() => {
    if (!live?.startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live?.startedAt]);

  async function changeStatus(next: Status) {
    const prev = status;
    setStatus(next);
    const r = await setAvailabilityAction(orgSlug, next);
    if (!r.ok) { setStatus(prev); toast.error(r.error); }
  }

  async function dial() {
    setError(null);
    if (!to.trim()) return setError("Enter a number to call.");
    setConnecting(true);
    const r = await prepareCallAction(orgSlug, { to, fromNumberId: fromId || undefined, customerId: context.customerId, leadId: context.leadId, orderId: context.orderId, ticketId: context.ticketId });
    if (!r.ok) { setConnecting(false); return setError(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error); }
    const d = await getDevice();
    if (!d) return setConnecting(false);
    try {
      const call = await d.connect({ params: r.data.params });
      attachCall(call, "outbound", context.label ? `${context.label} · ${r.data.e164}` : r.data.e164);
    } catch (e) {
      setError(micMessage(e as { code?: number; message?: string }));
    } finally {
      setConnecting(false);
    }
  }

  function answer() {
    if (!incoming) return;
    const call = incoming;
    setIncoming(null);
    attachCall(call, "inbound", call.parameters.From ?? "Caller");
    call.accept();
  }

  const elapsed = live?.startedAt ? Math.max(0, Math.floor((now - live.startedAt) / 1000)) : null;
  const clock = elapsed === null ? (live?.direction === "outbound" ? "Ringing…" : "Connecting…") : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {incoming && !open && (
        <div role="alertdialog" aria-label="Incoming call" className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-lg">
          <PhoneIncoming className="size-5 text-success" aria-hidden />
          <span className="text-sm font-medium">{incoming.parameters.From ?? "Incoming call"}</span>
          <Button size="sm" onClick={answer}>Answer</Button>
          <Button size="sm" variant="outline" onClick={() => { incoming.reject(); setIncoming(null); }}>Decline</Button>
        </div>
      )}
      {open && (
        <section aria-label="Phone" className="w-80 rounded-lg border bg-card shadow-xl">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", STATUS_DOT[status])} aria-hidden />
              <NativeSelect aria-label="Availability" value={status} onChange={(e) => changeStatus(e.target.value as Status)} className="h-8 w-40 text-xs" disabled={!!live}>
                {(["available", "away", "dnd", "offline"] as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </NativeSelect>
            </div>
            <Button size="icon" variant="ghost" aria-label="Close phone" onClick={() => setOpen(false)}><X /></Button>
          </header>
          <div className="space-y-3 p-3">
            {error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-xs text-danger">{error}</p>}
            {incoming ? (
              <div className="space-y-3 text-center">
                <p className="text-xs text-muted-foreground">Incoming call</p>
                <p className="text-lg font-semibold">{incoming.parameters.From ?? "Caller"}</p>
                <div className="flex justify-center gap-2">
                  <Button onClick={answer}><Phone /> Answer</Button>
                  <Button variant="outline" onClick={() => { incoming.reject(); setIncoming(null); }}>Decline</Button>
                </div>
              </div>
            ) : live ? (
              <div className="space-y-3">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">{live.direction === "inbound" ? "Inbound call" : "Outbound call"}</p>
                  <p className="text-lg font-semibold">{live.info?.customerName ?? live.other}</p>
                  {live.info?.customerName && <p className="text-xs text-muted-foreground">{live.other}</p>}
                  <p className="font-mono text-sm tabular-nums" aria-live="polite">{clock}</p>
                  {live.info && (
                    <p className="mt-1 text-xs">
                      <Link className="text-primary hover:underline" href={`/o/${orgSlug}/phone/calls/${live.info.id}`}>Call record</Link>
                      {live.info.customerId && <> · <Link className="text-primary hover:underline" href={`/o/${orgSlug}/customers/${live.info.customerId}`}>Customer</Link></>}
                    </p>
                  )}
                </div>
                {keypad && (
                  <div className="grid grid-cols-3 gap-1">
                    {KEYS.map((k) => <Button key={k} variant="outline" size="sm" onClick={() => live.call.sendDigits(k)} aria-label={`Send ${k}`}>{k}</Button>)}
                  </div>
                )}
                <div className="flex justify-center gap-2">
                  <Button variant="outline" size="icon" aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} onClick={() => live.call.mute(!muted)}>{muted ? <MicOff /> : <Mic />}</Button>
                  <Button variant="outline" size="icon" aria-pressed={keypad} aria-label="Keypad" onClick={() => setKeypad((k) => !k)}><Grid3x3 /></Button>
                  <Button variant="destructive" onClick={() => live.call.disconnect()}><PhoneOff /> Hang up</Button>
                </div>
              </div>
            ) : (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void dial(); }}>
                {context.label && <p className="text-xs text-muted-foreground">Calling {context.label}</p>}
                <div className="flex gap-1">
                  <Input aria-label="Number to call" inputMode="tel" placeholder="+1 555 123 4567" value={to} onChange={(e) => { setTo(e.target.value); if (context.label) setContext({}); }} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Delete digit" onClick={() => setTo((t) => t.slice(0, -1))}><Delete /></Button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {KEYS.map((k) => <Button key={k} type="button" variant="outline" size="sm" onClick={() => setTo((t) => t + k)}>{k}</Button>)}
                </div>
                {numbers.length > 1 && (
                  <NativeSelect aria-label="Call from" value={fromId} onChange={(e) => setFromId(e.target.value)} className="h-8 text-xs">
                    {numbers.map((n) => <option key={n.id} value={n.id}>{n.label ? `${n.label} · ${n.e164}` : n.e164}</option>)}
                  </NativeSelect>
                )}
                <Button type="submit" className="w-full" disabled={connecting}><Phone /> {connecting ? "Connecting…" : "Call"}</Button>
                {numbers.length === 1 && <p className="text-center text-xs text-muted-foreground">Calls show {numbers[0].e164}</p>}
              </form>
            )}
          </div>
        </section>
      )}
      {!open && (
        <Button onClick={() => setOpen(true)} className="rounded-full shadow-lg" aria-label={live ? "Phone · on a call" : `Phone · ${STATUS_LABEL[status]}`}>
          <span className={cn("size-2 rounded-full", live ? "bg-success" : STATUS_DOT[status])} aria-hidden />
          <Phone /> {live ? clock : "Phone"}
        </Button>
      )}
    </div>
  );
}

/** Small "Call" button for record pages. */
export function CallButton({ dial, className }: { dial: DialRequest; className?: string }) {
  return (
    <Button type="button" size="sm" variant="outline" className={className} onClick={() => requestDial(dial)} aria-label={`Call ${dial.label ?? dial.to}`}>
      <Phone /> Call
    </Button>
  );
}
