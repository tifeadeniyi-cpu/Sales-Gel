"use client";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, formatRelative } from "@/lib/utils";
import { markReadAction } from "./actions";

export interface NotificationView {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function MarkAllRead({ orgSlug, disabled }: { orgSlug: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => start(async () => { const r = await markReadAction(orgSlug); if (!r.ok) toast.error(r.error); })}>
      Mark all as read
    </Button>
  );
}

export function NotificationItem({ orgSlug, n }: { orgSlug: string; n: NotificationView }) {
  const [pending, start] = useTransition();
  const unread = !n.readAt;
  const markRead = () => start(async () => { if (unread) await markReadAction(orgSlug, n.id); });
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", unread && "bg-primary/5")}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-accent" : "bg-transparent")} aria-hidden />
      <div className="min-w-0 flex-1">
        {n.link ? (
          <Link href={n.link} onClick={markRead} className="font-medium hover:underline">{n.title}</Link>
        ) : (
          <span className="font-medium">{n.title}</span>
        )}
        {unread && <span className="sr-only"> (unread)</span>}
        {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
        <p className="text-xs text-muted-foreground">{formatRelative(n.createdAt)}</p>
      </div>
      {unread && <Button size="sm" variant="ghost" disabled={pending} onClick={markRead}>Mark read</Button>}
    </li>
  );
}
