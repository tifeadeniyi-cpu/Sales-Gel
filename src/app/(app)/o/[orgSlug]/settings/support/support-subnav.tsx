import { LinkTabs } from "@/components/ui/tabs";

export type SupportSection = "statuses" | "hours" | "sla" | "routing" | "forms" | "portal";

export function SupportSubnav({ orgSlug, active, canConfigure }: { orgSlug: string; active: SupportSection; canConfigure: boolean }) {
  const base = `/o/${orgSlug}/settings/support`;
  const tabs = [{ key: "statuses", label: "Statuses & types", href: base }];
  if (canConfigure) {
    tabs.push(
      { key: "hours", label: "Business hours", href: `${base}/hours` },
      { key: "sla", label: "SLA policies", href: `${base}/sla` },
      { key: "routing", label: "Routing", href: `${base}/routing` },
      { key: "forms", label: "Forms", href: `${base}/forms` },
      { key: "portal", label: "Customer portal", href: `${base}/portal` },
    );
  }
  return <div className="mt-4"><LinkTabs active={active} tabs={tabs} /></div>;
}
