"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CURRENT_PHASE, type NavItem } from "./nav-config";
import { NavIcon } from "./icons";

export function NavList({
  orgSlug,
  groups,
  unread,
  collapsed = false,
  onNavigate,
}: {
  orgSlug: string;
  groups: { label: string; items: NavItem[] }[];
  unread: number;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = `/o/${orgSlug}`;
  const hrefOf = (item: NavItem) => (item.path ? `${base}/${item.path}` : base);
  const matches = (item: NavItem) =>
    item.path ? pathname === hrefOf(item) || pathname.startsWith(`${hrefOf(item)}/`) : pathname === base;
  // Most specific match wins (support/tickets over support).
  const activeKey = groups
    .flatMap((g) => g.items)
    .filter(matches)
    .sort((a, b) => b.path.length - a.path.length)[0]?.key;

  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-3">
      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          {!collapsed && (
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</div>
          )}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const active = item.key === activeKey;
              const soon = item.phase > CURRENT_PHASE;
              return (
                <li key={item.key}>
                  <Link
                    href={hrefOf(item)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-2 py-1.5 text-sm",
                      active ? "bg-primary/10 font-medium text-primary" : "text-ink/80 hover:bg-muted",
                      soon && !active && "text-ink/50",
                    )}
                  >
                    {active && <span className="absolute inset-y-1 left-0 w-0.5 rounded bg-primary" aria-hidden />}
                    <NavIcon name={item.icon} className="size-4 shrink-0" />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.key === "notifications" && unread > 0 && (
                      <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" aria-label={`${unread} unread`}>
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                    {!collapsed && soon && <span className="text-[10px] uppercase text-muted-foreground">Soon</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
