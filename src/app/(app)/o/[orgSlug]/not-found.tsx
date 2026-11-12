import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Button asChild variant="outline"><Link href="/o">Back to my workspaces</Link></Button>
    </div>
  );
}
