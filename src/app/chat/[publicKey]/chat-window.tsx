"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { pollChatAction, sendChatAction, startChatAction } from "../actions";

type Msg = { id: string; from: "you" | "team"; body: string; createdAt: Date | string };
const storeKey = (k: string) => `salesgel-chat:${k}`;
function readToken(k: string) { try { return localStorage.getItem(storeKey(k)); } catch { return null; } }
function writeToken(k: string, v: string | null) { try { if (v) localStorage.setItem(storeKey(k), v); else localStorage.removeItem(storeKey(k)); } catch { /* storage blocked: session lasts while the window is open */ } }

/** Readable text color for the header on the brand color. */
function ink(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0b1220" : "#ffffff";
}

export function ChatWindow({ publicKey, cfg, page }: { publicKey: string; cfg: { title: string; greeting: string; color: string; askEmail: boolean; orgName: string }; page: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [closed, setClosed] = useState(false);
  const [text, setText] = useState("");
  const [who, setWho] = useState({ name: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async (t: string) => {
    const r = await pollChatAction(publicKey, t);
    if (!r.ok) return;
    if ("gone" in r.data) { writeToken(publicKey, null); setToken(null); setMessages([]); return; }
    setMessages(r.data.messages);
    setClosed(r.data.closed);
  }, [publicKey]);

  useEffect(() => {
    // localStorage is only readable in the browser; restore the visitor's session after mount.
    const t = readToken(publicKey);
    if (t) queueMicrotask(() => { setToken(t); void poll(t); });
  }, [publicKey, poll]);
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") void poll(token); }, 4000);
    return () => clearInterval(id);
  }, [token, poll]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    start(async () => {
      if (!token) {
        const r = await startChatAction(publicKey, { name: who.name, email: who.email, message: body }, page);
        if (!r.ok) return void setError(Object.values(r.fieldErrors ?? {})[0]?.[0] ?? r.error);
        writeToken(publicKey, r.data.token);
        setToken(r.data.token);
        setText("");
        await poll(r.data.token);
        return;
      }
      const r = await sendChatAction(publicKey, token, body);
      if (!r.ok) return void setError(r.error);
      setText("");
      await poll(token);
    });
  };

  const fg = ink(cfg.color);
  return (
    <main className="flex h-dvh flex-col bg-white text-sm text-slate-900">
      <header className="px-4 py-3" style={{ background: cfg.color, color: fg }}>
        <h1 className="font-semibold">{cfg.title}</h1>
        <p className="text-xs opacity-85">{cfg.orgName}</p>
      </header>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite" aria-label="Messages">
        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2">{cfg.greeting}</div>
        {messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 ${m.from === "you" ? "ml-auto rounded-br-sm" : "rounded-bl-sm bg-slate-100"}`}
            style={m.from === "you" ? { background: cfg.color, color: fg } : undefined}>
            <span className="sr-only">{m.from === "you" ? "You: " : `${cfg.orgName}: `}</span>{m.body}
          </div>
        ))}
        {token && messages.length > 0 && messages[messages.length - 1].from === "you" && <p className="text-center text-xs text-slate-500">Sent. The team will reply here{cfg.askEmail ? " or by email" : ""}.</p>}
        {closed && <p className="text-center text-xs text-slate-500">This conversation was closed. Send a message to reopen it.</p>}
        <div ref={endRef} />
      </div>
      <form className="space-y-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {!token && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-0.5 text-xs font-medium">Name<input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} autoComplete="name" className="h-8 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" /></label>
            <label className="grid gap-0.5 text-xs font-medium">Email{cfg.askEmail && <span className="sr-only"> (required)</span>}<input type="email" value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} autoComplete="email" required={cfg.askEmail} className="h-8 rounded-md border px-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" /></label>
          </div>
        )}
        <div className="flex gap-2">
          <label htmlFor="chat-msg" className="sr-only">Message</label>
          <textarea id="chat-msg" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="min-h-10 flex-1 resize-none rounded-md border px-2 py-1.5 outline-none focus:ring-2 focus:ring-slate-300" />
          <button type="submit" disabled={pending || !text.trim()} className="rounded-md px-3 font-medium disabled:opacity-50" style={{ background: cfg.color, color: fg }}>{pending ? "…" : "Send"}</button>
        </div>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <p className="text-center text-[10px] text-slate-400">Powered by SalesGel</p>
      </form>
    </main>
  );
}
