"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CURRENT_PHASE, type NavItem } from "./nav-config";
import { NavIcon } from "./icons";

/**
 * Dark sidebar navigation. In the desktop sidebar, labels hide below `lg` (tablet = icon rail)
 * unless `full` is set (the mobile drawer); `collapsed` forces the icon rail at any width.
 */
export function NavList({
  orgSlug,
  groups,
  unread,
  counts = {},
  collapsed = false,
  full = false,
  onNavigate,
}: {
  orgSlug: string;
  groups: { label: string; collapsible?: boolean; items: NavItem[] }[];
  unread: number;
  /** Badge counts keyed by nav item key (e.g. open tickets, unread inbox). */
  counts?: Record<string, number>;
  collapsed?: boolean;
  full?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;
  const hrefOf = (item: NavItem) => (item.path ? `${base}/${item.path}` : base);
  const matches = (item: NavItem) => (item.path ? pathname === hrefOf(item) || pathname.startsWith(`${hrefOf(item)}/`) : pathname === base);
  const all = groups.flatMap((g) => g.items);
  const activeKey = all.filter(matches).sort((a, b) => b.path.length - a.path.length)[0]?.key;
  const moreActive = groups.some((g) => g.collapsible && g.items.some((i) => i.key === activeKey));
  const [moreOpen, setMoreOpen] = useState(moreActive);
  const label = collapsed ? "sr-only" : full ? "" : "max-lg:sr-only";
  const visual = collapsed ? "hidden" : full ? "" : "max-lg:hidden";

  const badge = (item: NavItem) => {
    const n = item.key === "notifications" ? unread : counts[item.key] ?? 0;
    if (n <= 0) return null;
    return (
      <span className={cn("ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-navy", visual)} aria-label={item.key === "notifications" ? `${n} unread` : `${n} open`}>
        {n > 99 ? "99+" : n}
      </span>
    );
  };

  const renderItem = (item: NavItem) => {
    const active = item.key === activeKey;
    const soon = item.phase > CURRENT_PHASE;
    const n = item.key === "notifications" ? unread : counts[item.key] ?? 0;
    return (
      <li key={item.key}>
        <Link
          href={hrefOf(item)}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          title={item.label}
          className={cn(
            "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-accent",
            active ? "bg-primary font-medium text-white shadow-sm shadow-primary/30" : "text-white/75 hover:bg-white/10 hover:text-white",
            soon && !active && "text-white/45",
          )}
        >
          <NavIcon name={item.icon} className="size-[18px] shrink-0" />
          <span className={cn("flex-1 truncate", label)}>{item.label}</span>
          {badge(item)}
          {soon && <span className={cn("rounded bg-white/10 px-1.5 text-[10px] uppercase tracking-wide text-white/60", visual)}>Soon</span>}
          {(collapsed || !full) && n > 0 && <span className={cn("absolute right-1.5 top-1.5 size-2 rounded-full bg-accent", collapsed ? "" : "lg:hidden")} aria-hidden />}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map((g) =>
        g.collapsible ? (
          <div key={g.label} className="mt-3 border-t border-white/10 pt-3">
            <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} title={g.label}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white/50 hover:text-white">
              <ChevronDown className={cn("size-4 shrink-0 transition-transform", !moreOpen && "-rotate-90")} aria-hidden />
              <span className={label}>{g.label}</span>
            </button>
            {moreOpen && <ul className="mt-1 space-y-0.5">{g.items.map(renderItem)}</ul>}
          </div>
        ) : (
          <ul key={g.label || "primary"} className="space-y-0.5">{g.items.map(renderItem)}</ul>
        ),
      )}
    </nav>
  );
}
