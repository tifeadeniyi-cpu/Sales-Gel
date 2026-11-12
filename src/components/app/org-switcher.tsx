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

export function OrgSwitcher({ current, orgs, compactClass = "" }: { current: OrgOption; orgs: OrgOption[]; compactClass?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-left text-white hover:bg-white/10" aria-label="Switch organization">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-navy">
          {initials(current.name)}
        </span>
        <span className={`min-w-0 flex-1 ${compactClass}`}>
          <span className="block text-[10px] uppercase tracking-wider text-white/50">Workspace</span>
          <span className="block truncate text-sm font-semibold">{current.name}</span>
        </span>
        <ChevronsUpDown className={`size-4 text-white/60 ${compactClass.replace("sr-only", "hidden")}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
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
            <Plus /> Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
