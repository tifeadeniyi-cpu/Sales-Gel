"use client";
import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "./nav-config";
import { Bell, CheckCircle2, CircleHelp, Filter, KanbanSquare, LogOut, Plus, Search, Settings, ShoppingBag, Ticket, UserPlus, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/(auth)/actions";

export function Topbar({
  orgSlug,
  user,
  unread,
  canInvite,
  canCreateCustomer,
  canCreateLead,
  canCreateTask,
  canCreateOrder,
  canCreateTicket,
  mobileNav,
}: {
  orgSlug: string;
  user: { name: string; email: string; image: string | null };
  unread: number;
  canInvite: boolean;
  canCreateCustomer: boolean;
  canCreateLead: boolean;
  canCreateTask: boolean;
  canCreateOrder?: boolean;
  canCreateTicket?: boolean;
  mobileNav?: React.ReactNode;
}) {
  const base = `/o/${orgSlug}`;
  const pathname = usePathname();
  const rest = pathname.slice(base.length).replace(/^\//, "");
  const items = NAV_GROUPS.flatMap((g) => g.items);
  const section = items
    .filter((i) => (i.path ? rest === i.path || rest.startsWith(`${i.path}/`) : rest === ""))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const isRecord = section && rest !== section.path && rest.split("/").length > section.path.split("/").filter(Boolean).length;
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur lg:px-6">
      {mobileNav}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 shrink-0 text-sm xl:block">
        {section ? (
          isRecord ? (
            <span className="flex items-center gap-1.5"><Link href={section.path ? `${base}/${section.path}` : base} className="text-muted-foreground hover:text-ink">{section.label}</Link><span className="text-muted-foreground">/</span><span className="font-medium">Details</span></span>
          ) : <span className="font-semibold">{section.label}</span>
        ) : rest === "search" ? <span className="font-semibold">Search</span> : null}
      </nav>
      <form action={`${base}/search`} method="get" role="search" className="relative mx-auto max-w-xl flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          placeholder="Search contacts, deals, orders, tickets…"
          aria-label="Global search"
          className="h-10 w-full rounded-full border bg-muted/40 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:bg-card"
        />
      </form>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Quick create" className="rounded-full">
              <Plus /> <span className="hidden sm:inline">Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Quick create</DropdownMenuLabel>
            {canCreateCustomer && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/customers/new`}>
                  <UserRound /> Contact
                </Link>
              </DropdownMenuItem>
            )}
            {canCreateLead && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/leads?new=1`}>
                  <Filter /> Lead
                </Link>
              </DropdownMenuItem>
            )}
            {canCreateLead && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/deals?new=1`}>
                  <KanbanSquare /> Deal
                </Link>
              </DropdownMenuItem>
            )}
            {canCreateOrder && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/orders/new`}>
                  <ShoppingBag /> Order
                </Link>
              </DropdownMenuItem>
            )}
            {canCreateTicket && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/support/tickets?new=1`}>
                  <Ticket /> Ticket
                </Link>
              </DropdownMenuItem>
            )}
            {canCreateTask && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/tasks?new=1`}>
                  <CheckCircle2 /> Task
                </Link>
              </DropdownMenuItem>
            )}
            {canInvite && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/team?invite=1`}>
                  <UserPlus /> Invite team member
                </Link>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" asChild>
          <Link href={`${base}/notifications`} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
            <Bell />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-navy">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        </Button>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/help" aria-label="Help">
            <CircleHelp />
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="ml-1 rounded-full" aria-label="Your account">
            <Avatar name={user.name} src={user.image} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel className="text-ink">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={`${base}/settings/notifications`}>
                <Settings /> Notification preferences
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOutAction()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
