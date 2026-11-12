import { LinkTabs } from "@/components/ui/tabs";

export function TeamTabs({ orgSlug, active }: { orgSlug: string; active: "members" | "roles" | "teams" }) {
  const base = `/o/${orgSlug}/team`;
  return (
    <LinkTabs
      active={active}
      tabs={[
        { key: "members", label: "Members", href: base },
        { key: "roles", label: "Roles & permissions", href: `${base}/roles` },
        { key: "teams", label: "Teams", href: `${base}/teams` },
      ]}
    />
  );
}
