import { LinkTabs } from "@/components/ui/tabs";

export function SettingsTabs({ orgSlug, active, showAudit, showSupport }: { orgSlug: string; active: "general" | "customers" | "support" | "notifications" | "audit"; showAudit: boolean; showSupport?: boolean }) {
  const base = `/o/${orgSlug}/settings`;
  const tabs = [
    { key: "general", label: "General", href: base },
    { key: "customers", label: "Customer fields & tags", href: `${base}/customers` },
  ];
  if (showSupport) tabs.push({ key: "support", label: "Support", href: `${base}/support` });
  tabs.push({ key: "notifications", label: "Notifications", href: `${base}/notifications` });
  if (showAudit) tabs.push({ key: "audit", label: "Security & audit log", href: `${base}/audit` });
  return <LinkTabs active={active} tabs={tabs} />;
}
