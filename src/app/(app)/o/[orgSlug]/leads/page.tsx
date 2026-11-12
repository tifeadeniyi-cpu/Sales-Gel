import { PipelinePage } from "./_components/pipeline-page";

type SP = Record<string, string | undefined>;

/** Leads: the list view of every opportunity. The same records appear as a board under Deals. */
export default function LeadsPage(props: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  return <PipelinePage {...props} mode="leads" />;
}
