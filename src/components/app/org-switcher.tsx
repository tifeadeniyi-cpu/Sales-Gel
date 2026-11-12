"use client";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@/lib/utils";

export interface OrgOption {
  slug: string;
  name: string;
}

export function OrgSwitcher({ current, orgs, collapsed }: { current: OrgOption; orgs: OrgOption[]; collapsed?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted" aria-label="Switch organization">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-white">
          {initials(current.name)}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-sm font-semibold">{current.name}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((o) => (
          <DropdownMenuItem key={o.slug} asChild>
            <Link href={`/o/${o.slug}`}>
              <span className="flex size-6 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">{initials(o.name)}</span>
              <span className="flex-1 truncate">{o.name}</span>
              {o.slug === current.slug && <Check className="text-primary" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus /> Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
