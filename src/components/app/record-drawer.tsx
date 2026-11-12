"use client";
import { Dialog as D } from "radix-ui";
import Link from "next/link";
import { ChevronDown, ChevronUp, Link2, Maximize2, X } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useUrlParams } from "./use-url-params";

/**
 * Record drawer driven by the `open` search param, so the list underneath keeps its
 * filters, page and scroll position, and the URL is a shareable deep link.
 */
export function RecordDrawer({
  title,
  subtitle,
  fullHref,
  prevId,
  nextId,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  fullHref: string;
  prevId?: string | null;
  nextId?: string | null;
  children: React.ReactNode;
}) {
  const { set } = useUrlParams();
  const close = () => set({ open: null });
  const go = (id: string | null | undefined) => id && set({ open: id }, { replace: true });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLElement) || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (e.key === "j") go(nextId);
      if (e.key === "k") go(prevId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <D.Root open onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l bg-card shadow-xl focus:outline-none" aria-describedby={undefined}>
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <D.Title className="truncate text-lg font-semibold">{title}</D.Title>
              {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            <Button size="icon" variant="ghost" aria-label="Previous record" disabled={!prevId} onClick={() => go(prevId)}><ChevronUp /></Button>
            <Button size="icon" variant="ghost" aria-label="Next record" disabled={!nextId} onClick={() => go(nextId)}><ChevronDown /></Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Copy link"
              onClick={() => { void navigator.clipboard.writeText(new URL(fullHref, window.location.origin).toString()); toast.success("Link copied"); }}
            >
              <Link2 />
            </Button>
            <Button size="icon" variant="ghost" asChild><Link href={fullHref} aria-label="Open full page"><Maximize2 /></Link></Button>
            <D.Close asChild><Button size="icon" variant="ghost" aria-label="Close"><X /></Button></D.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
