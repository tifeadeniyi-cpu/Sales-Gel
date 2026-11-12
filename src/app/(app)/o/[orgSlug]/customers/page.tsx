import Link from "next/link";
import { forbidden } from "next/navigation";
import { Download, GitMerge, Plus, Upload, Users } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Pagination } from "@/components/app/pagination";
import { RecordDrawer } from "@/components/app/record-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCustomer, getCustomerStats, listCustomerIds, listCustomers, listNotes } from "@/domains/customers/service";
import { formatCustomerNumber } from "@/domains/customers/normalize";
import { canAny } from "@/server/authz/guards";
import { requireOrgContext } from "@/server/authz/request";
import { CustomerFilters } from "./_components/customer-filters";
import { CustomerProfile } from "./_components/customer-profile";
import { CustomerTable } from "./_components/customer-table";
import { NotesPanel } from "./_components/notes-panel";
import { STATUS } from "./_components/labels";
import { customerPerms, loadCustomerLookups } from "./_components/load";

type SP = Record<string, string | string[] | undefined>;
const FILTER_KEYS = ["q", "view", "owner", "tag", "source", "type", "marketing", "sort", "page", "pageSize"] as const;

function pickFilters(sp: SP) {
  const f: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = sp[k];
    if (typeof v === "string" && v) f[k] = v;
  }
  return f;
}

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!canAny(ctx, "customers.read", "customers.read_assigned")) forbidden();
  const sp = await searchParams;
  const filters = pickFilters(sp);
  const perms = customerPerms(ctx);
  const openId = typeof sp.open === "string" ? sp.open : null;

  let list;
  try {
    list = await listCustomers(ctx, filters);
  } catch {
    list = await listCustomers(ctx, {});
  }
  const [stats, lookups] = await Promise.all([getCustomerStats(ctx), loadCustomerLookups(ctx)]);
  const base = `/o/${orgSlug}/customers`;
  const qs = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...filters });
    for (const [k, v] of Object.entries(extra)) if (v === null) p.delete(k); else p.set(k, v);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  // Drawer
  let drawer = null;
  if (openId && /^[0-9a-f-]{36}$/i.test(openId)) {
    const c = await getCustomer(ctx, openId);
    if (c) {
      const [notes, ids] = await Promise.all([listNotes(ctx, c.id), listCustomerIds(ctx, filters)]);
      const idx = ids.indexOf(c.id);
      drawer = (
        <RecordDrawer
          title={c.displayName}
          subtitle={<>{formatCustomerNumber(c.number)} · <Badge tone={STATUS[c.status]?.tone ?? "neutral"}>{STATUS[c.status]?.label}</Badge></>}
          fullHref={`${base}/${c.id}`}
          prevId={idx > 0 ? ids[idx - 1] : null}
          nextId={idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null}
        >
          <div className="space-y-6 p-5">
            {c.status === "merged" && (
              <p className="rounded-md border border-info/30 bg-info/10 p-3 text-sm text-info">
                Merged into another customer. <Link className="underline" href={`${base}/${c.mergedIntoId}`}>Open the surviving record</Link>.
              </p>
            )}
            <CustomerProfile orgSlug={orgSlug} customer={c} members={lookups.members} allTags={lookups.tags} customFields={lookups.customFields} perms={{ write: perms.write, assign: perms.assign }} />
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
              <NotesPanel orgSlug={orgSlug} customerId={c.id} notes={notes.slice(0, 5)} currentUserId={ctx.userId} canWrite={perms.write && c.status !== "merged"} canDeleteAny={perms.archive} />
              {notes.length > 5 && <Link href={`${base}/${c.id}?tab=notes`} className="mt-2 inline-block text-sm text-primary hover:underline">See all {notes.length} notes</Link>}
            </section>
          </div>
        </RecordDrawer>
      );
    }
  }

  const hasFilters = Object.keys(filters).some((k) => !["sort", "page", "pageSize"].includes(k));
  return (
    <>
      <PageHeader
        title="Customers & Contacts"
        description="One connected profile for every customer relationship."
        actions={
          <>
            {perms.merge && <Button asChild variant="outline"><Link href={`${base}/duplicates`}><GitMerge /> Duplicates</Link></Button>}
            {perms.import && <Button asChild variant="outline"><Link href={`${base}/import`}><Upload /> Import</Link></Button>}
            {perms.export && <Button asChild variant="outline"><a href={`${base}/export?${new URLSearchParams(filters).toString()}`} download><Download /> Export</a></Button>}
            {perms.write && <Button asChild><Link href={`${base}/new`}><Plus /> Add customer</Link></Button>}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Active customers", value: stats.active },
          { label: "New in last 30 days", value: stats.new30 },
          { label: "Provisional contacts", value: stats.provisional },
          { label: "Email subscribers", value: stats.subscribed },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold">{s.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CustomerFilters members={lookups.members} tags={lookups.tags} canSeeAll={perms.readAll} />

      <Card className="mt-4 overflow-hidden">
        {list.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Users className="size-8" />}
              title={hasFilters ? "No customers match these filters" : "No customers yet"}
              description={hasFilters ? "Try a different search or clear the filters." : "Add your first customer or import a CSV from your store or spreadsheet."}
              action={!hasFilters && perms.write ? <Button asChild><Link href={`${base}/new`}><Plus /> Add customer</Link></Button> : undefined}
            />
          </div>
        ) : (
          <CustomerTable
            orgSlug={orgSlug}
            rows={list.rows}
            members={lookups.members}
            tags={lookups.tags}
            perms={{ write: perms.write, archive: perms.archive, assign: perms.assign }}
            layout={sp.layout === "cards" ? "cards" : "list"}
          />
        )}
        <Pagination page={list.page} pageCount={list.pageCount} total={list.total} pageSize={list.pageSize} hrefFor={(p) => qs({ page: p <= 1 ? null : String(p), open: null })} />
      </Card>
      {drawer}
    </>
  );
}
