import { MobileNav, Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { LastOrgCookie } from "@/components/app/last-org-cookie";
import { visibleNav } from "@/components/app/nav-config";
import { listMyOrganizations } from "@/domains/identity/service";
import { unreadNotificationCount } from "@/domains/platform/notifications";
import { countOpenTickets } from "@/domains/support/service";
import { inboxCounts } from "@/domains/inbox/service";
import { requireUser } from "@/server/auth/session";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { kickWorker } from "@/server/jobs/kick";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  const user = await requireUser();
  const [orgs, unread, openTickets, inbox] = await Promise.all([listMyOrganizations(user.id), unreadNotificationCount(ctx), countOpenTickets(ctx), inboxCounts(ctx)]);
  kickWorker(ctx.orgId);
  const groups = visibleNav(ctx.permissions);
  const orgOptions = orgs.map((o) => ({ slug: o.slug, name: o.name }));
  const navProps = { orgSlug, orgName: ctx.orgName, roleName: ctx.roleName, orgs: orgOptions, groups, unread, counts: { tickets: openTickets, inbox: inbox?.unread ?? 0 }, user: { name: user.name, email: user.email, image: user.image ?? null } };

  return (
    <div className="flex min-h-screen">
      <LastOrgCookie slug={orgSlug} />
      <Sidebar {...navProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar orgSlug={orgSlug} user={user} unread={unread} canInvite={can(ctx, "members.manage")} canCreateCustomer={can(ctx, "customers.write")} canCreateLead={can(ctx, "leads.write")} canCreateTask={can(ctx, "tasks.write")} canCreateOrder={can(ctx, "orders.write")} canCreateTicket={can(ctx, "tickets.write")} mobileNav={<MobileNav {...navProps} />} />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
