import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <ShieldAlert className="size-8 text-warning" aria-hidden />
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your role doesn&apos;t include this permission. Ask an Owner or Admin to update your role in Team &amp; Permissions.
      </p>
      <Button asChild variant="outline"><Link href="/o">Back to workspace</Link></Button>
    </div>
  );
}
