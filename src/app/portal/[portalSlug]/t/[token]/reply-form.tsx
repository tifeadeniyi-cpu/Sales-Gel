"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { replyPortalAction } from "../../../actions";

export function PortalReply({ slug, token }: { slug: string; token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="grid gap-2 rounded-xl border bg-card p-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); setError(null); start(async () => {
      const r = await replyPortalAction(slug, token, body);
      if (!r.ok) return void setError(r.fieldErrors?.body?.[0] ?? r.error);
      setBody("");
      router.refresh();
    }); }}>
      <label htmlFor="reply" className="text-sm font-medium">Add a reply</label>
      <Textarea id="reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" className="w-fit" disabled={pending || !body.trim()}>{pending ? "Sending…" : "Send reply"}</Button>
    </form>
  );
}

export function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button type="button" size="sm" variant="outline" className="mt-3" onClick={async () => {
      try { await navigator.clipboard.writeText(window.location.href.replace(/[?&]new=1/, "")); setCopied(true); } catch { setCopied(false); }
    }}>{copied ? "Link copied" : "Copy link"}</Button>
  );
}
