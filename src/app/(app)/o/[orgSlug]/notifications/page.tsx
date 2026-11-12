import { Bell } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";
import { listNotifications } from "@/domains/platform/notifications";
import { requireOrgContext } from "@/server/authz/request";
import { MarkAllRead, NotificationItem } from "./notification-list";

export default async function NotificationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const items = await listNotifications(ctx, { limit: 100 });
  const hasUnread = items.some((n) => !n.readAt);
  return (
    <>
      <PageHeader title="Notifications" description="Assignments, mentions and alerts for you in this organization." actions={<MarkAllRead orgSlug={orgSlug} disabled={!hasUnread} />} />
      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-8" />} title="You're all caught up" description="Assignments, mentions and alerts will show up here." />
      ) : (
        <Card>
          <ul className="divide-y">
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                orgSlug={orgSlug}
                n={{ id: n.id, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() }}
              />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
