import Link from "next/link";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { listPipelines } from "@/domains/sales/service";
import { requireOrgContext } from "@/server/authz/request";
import { can } from "@/server/authz/guards";
import { PipelineEditor } from "./pipeline-editor";

export default async function PipelineSettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "pipelines.manage")) forbidden();
  const pipelines = await listPipelines(ctx);
  return (
    <>
      <Link href={`/o/${orgSlug}/leads`} className="text-sm text-primary hover:underline">← Leads</Link>
      <PageHeader className="mt-3" title="Pipeline settings" description="Stages, win probabilities and the fields a lead needs before it can enter each stage." />
      <PipelineEditor orgSlug={orgSlug} pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault, stages: p.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, probability: s.probability, category: s.category, requiredFields: s.requiredFields, leadCount: s.leadCount })) }))} />
    </>
  );
}
