"use client";
import { ChevronsLeft, ChevronsRight, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { NavItem } from "./nav-config";
import { NavList } from "./nav-list";
import { OrgSwitcher, type OrgOption } from "./org-switcher";

interface SidebarProps {
  orgSlug: string;
  orgName: string;
  orgs: OrgOption[];
  groups: { label: string; items: NavItem[] }[];
  unread: number;
  counts?: Record<string, number>;
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
      try {
        localStorage.setItem("crm.sidebar.collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });

  return (
    <aside
      className={cn("sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card transition-[width] md:flex", collapsed ? "w-16" : "w-64")}
    >
      <div className="flex h-14 items-center border-b px-3">
        <OrgSwitcher current={{ slug: props.orgSlug, name: props.orgName }} orgs={props.orgs} collapsed={collapsed} />
      </div>
      <NavList orgSlug={props.orgSlug} groups={props.groups} unread={props.unread} counts={props.counts} collapsed={collapsed} />
      <button
        type="button"
        onClick={toggle}
        className="flex h-10 items-center justify-center gap-2 border-t text-xs text-muted-foreground hover:bg-muted"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="size-4" /> : (<><ChevronsLeft className="size-4" /> Collapse</>)}
      </button>
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
      <DialogContent side="right" className="left-0 right-auto max-w-72 border-l-0 border-r p-0">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-14 items-center border-b px-3 pr-10">
          <OrgSwitcher current={{ slug: props.orgSlug, name: props.orgName }} orgs={props.orgs} />
        </div>
        <NavList orgSlug={props.orgSlug} groups={props.groups} unread={props.unread} counts={props.counts} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
