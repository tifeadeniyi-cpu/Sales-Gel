import { LinkTabs } from "@/components/ui/tabs";

export function SettingsTabs({ orgSlug, active, showAudit }: { orgSlug: string; active: "general" | "customers" | "notifications" | "audit"; showAudit: boolean }) {
  const base = `/o/${orgSlug}/settings`;
  const tabs = [
    { key: "general", label: "General", href: base },
    { key: "customers", label: "Customer fields & tags", href: `${base}/customers` },
    { key: "notifications", label: "Notifications", href: `${base}/notifications` },
  ];
  if (showAudit) tabs.push({ key: "audit", label: "Security & audit log", href: `${base}/audit` });
  return <LinkTabs active={active} tabs={tabs} />;
}
