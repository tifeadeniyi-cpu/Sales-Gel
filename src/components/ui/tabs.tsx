import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (server-rendered, deep-linkable). */
export function LinkTabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
            t.key === active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-ink",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
