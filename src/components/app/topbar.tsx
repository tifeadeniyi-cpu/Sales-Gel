"use client";
import type React from "react";
import Link from "next/link";
import { Bell, CircleHelp, LogOut, Plus, Search, Settings, UserPlus } from "lucide-react";
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
  mobileNav,
}: {
  orgSlug: string;
  user: { name: string; email: string; image: string | null };
  unread: number;
  canInvite: boolean;
  mobileNav?: React.ReactNode;
}) {
  const base = `/o/${orgSlug}`;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur">
      {mobileNav}
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          disabled
          placeholder="Search arrives with Customers (Phase 2)"
          aria-label="Global search (available in Phase 2)"
          className="h-9 w-full rounded-md border bg-muted/50 pl-8 pr-3 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" aria-label="Quick create">
              <Plus /> <span className="hidden sm:inline">Create</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Quick create</DropdownMenuLabel>
            {canInvite && (
              <DropdownMenuItem asChild>
                <Link href={`${base}/team?invite=1`}>
                  <UserPlus /> Invite team member
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal">Customer, lead, order, ticket and task creation arrive in Phases 2–5.</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" asChild>
          <Link href={`${base}/notifications`} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
            <Bell />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
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
          <DropdownMenuTrigger className="ml-1 rounded-full" aria-label="Account menu">
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
