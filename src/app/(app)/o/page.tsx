import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listMyOrganizations } from "@/domains/identity/service";
import { requireUser } from "@/server/auth/session";

/** Sends the user to their last-used org (if still a member), else the first, else onboarding. */
export default async function OrgIndex() {
  const user = await requireUser();
  const orgs = await listMyOrganizations(user.id);
  if (orgs.length === 0) redirect("/onboarding");
  const last = (await cookies()).get("crm_last_org")?.value;
  const target = orgs.find((o) => o.slug === last) ?? orgs[0];
  redirect(`/o/${target.slug}`);
}
