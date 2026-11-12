"use client";
import Link from "next/link";
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Settings, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-config";
import { NavList } from "./nav-list";
import { OrgSwitcher, type OrgOption } from "./org-switcher";

interface SidebarProps {
  orgSlug: string;
  orgName: string;
  roleName: string;
  orgs: OrgOption[];
  groups: { label: string; collapsible?: boolean; items: NavItem[] }[];
  unread: number;
  counts?: Record<string, number>;
  user: { name: string; email: string; image: string | null };
}

function ProfileMenu({ user, orgSlug, roleName, compact }: { user: SidebarProps["user"]; orgSlug: string; roleName: string; compact: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg p-2 text-left text-white hover:bg-white/10" aria-label="Account menu">
        <Avatar name={user.name} src={user.image} />
        <span className={cn("min-w-0 flex-1", compact)}>
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-white/60">{roleName}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel className="text-ink">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={`/o/${orgSlug}/settings/notifications`}><Settings /> Notification preferences</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={`/o/${orgSlug}/team`}><UserRound /> Team & permissions</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOutAction()}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Sidebar(props: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      // Restoring a persisted UI preference from localStorage (external system) after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem("crm.sidebar.collapsed") === "1");
    } catch {}
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try { localStorage.setItem("crm.sidebar.collapsed", c ? "0" : "1"); } catch {}
      return !c;
    });
  // Tablet (md–lg) shows the icon rail; desktop shows the full sidebar unless collapsed.
  const compact = collapsed ? "sr-only" : "max-lg:sr-only";

  return (
    <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-navy text-white transition-[width] md:flex", collapsed ? "w-[4.5rem]" : "w-[4.5rem] lg:w-[17rem]")}>
      <div className="flex h-16 items-center px-4">
        <Link href={`/o/${props.orgSlug}`} aria-label="SalesGel home" className="rounded-md focus-visible:outline-accent">
          <span className={collapsed ? "" : "lg:hidden"}><Logo tone="dark" collapsed /></span>
          {!collapsed && <span className="max-lg:hidden"><Logo tone="dark" /></span>}
        </Link>
      </div>
      <div className="px-3 pb-2">
        <OrgSwitcher current={{ slug: props.orgSlug, name: props.orgName }} orgs={props.orgs} compactClass={compact} />
      </div>
      <NavList orgSlug={props.orgSlug} groups={props.groups} unread={props.unread} counts={props.counts} collapsed={collapsed} />
      <div className="border-t border-white/10 p-3">
        <ProfileMenu user={props.user} orgSlug={props.orgSlug} roleName={props.roleName} compact={compact} />
        <button type="button" onClick={toggle} className="mt-1 hidden w-full items-center justify-center gap-2 rounded-lg py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <ChevronsRight className="size-4" /> : (<><ChevronsLeft className="size-4" /> Collapse</>)}
        </button>
      </div>
    </aside>
  );
}

export function MobileNav(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="rounded-md p-2 hover:bg-muted md:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </DialogTrigger>
      <DialogContent side="right" className="left-0 right-auto flex max-w-72 flex-col border-l-0 bg-navy p-0 text-white">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-16 items-center px-4"><Logo tone="dark" /></div>
        <div className="px-3 pb-2"><OrgSwitcher current={{ slug: props.orgSlug, name: props.orgName }} orgs={props.orgs} compactClass="" /></div>
        <NavList orgSlug={props.orgSlug} groups={props.groups} unread={props.unread} counts={props.counts} full onNavigate={() => setOpen(false)} />
        <div className="border-t border-white/10 p-3"><ProfileMenu user={props.user} orgSlug={props.orgSlug} roleName={props.roleName} compact="" /></div>
      </DialogContent>
    </Dialog>
  );
}
