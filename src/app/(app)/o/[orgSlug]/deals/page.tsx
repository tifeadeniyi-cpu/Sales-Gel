import { PipelinePage } from "../leads/_components/pipeline-page";

type SP = Record<string, string | undefined>;

/** Deals: the pipeline board over the same lead records as the Leads list. */
export default function DealsPage(props: { params: Promise<{ orgSlug: string }>; searchParams: Promise<SP> }) {
  return <PipelinePage {...props} mode="deals" />;
}
