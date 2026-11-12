import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CURRENT_PHASE, findNavItemByPath } from "@/components/app/nav-config";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrgContext } from "@/server/authz/request";

/**
 * Honest placeholder for modules scheduled in later phases. It never renders
 * fake data or controls that look functional.
 */
export default async function ComingSoon({ params }: { params: Promise<{ orgSlug: string; rest: string[] }> }) {
  const { orgSlug, rest } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const item = findNavItemByPath(rest.join("/"));
  if (!item || item.phase <= CURRENT_PHASE) notFound();
  if (item.anyOf && !item.anyOf.some((p) => ctx.permissions.has(p))) notFound();
  return (
    <>
      <PageHeader title={item.label} description={item.description} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Clock className="size-8 text-highlight" aria-hidden />
          <h2 className="text-lg font-semibold">Scheduled for Phase {item.phase}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            This module isn&apos;t built yet. It will appear here, connected to your existing records, when Phase {item.phase} ships.
            No placeholder data is shown in the meantime.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
