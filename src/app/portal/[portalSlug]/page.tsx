import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortal } from "@/domains/support/portal";
import { PortalRequestForm } from "./request-form";

export async function generateMetadata({ params }: { params: Promise<{ portalSlug: string }> }): Promise<Metadata> {
  const p = await getPortal((await params).portalSlug);
  return { title: p ? p.title : "Support" };
}

export default async function PortalHome({ params }: { params: Promise<{ portalSlug: string }> }) {
  const { portalSlug } = await params;
  const portal = await getPortal(portalSlug);
  if (!portal) notFound();
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">{portal.orgName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{portal.title}</h1>
        {portal.welcome && <p className="mt-2 whitespace-pre-line text-muted-foreground">{portal.welcome}</p>}
      </header>
      <section className="rounded-xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="req-h">
        <h2 id="req-h" className="mb-4 text-lg font-semibold">Send us a request</h2>
        <PortalRequestForm slug={portal.slug} forms={portal.forms.map((f) => ({ id: f.id, name: f.name, description: f.description, fields: f.fields }))} />
      </section>
    </div>
  );
}
