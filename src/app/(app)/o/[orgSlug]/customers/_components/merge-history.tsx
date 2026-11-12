"use client";
import Link from "next/link";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { unmergeAction } from "../actions";

export function MergeHistory({ orgSlug, merges, canMerge }: { orgSlug: string; merges: { id: string; mergedId: string; mergedName: string; mergedNumber: number; createdAt: Date; revertedAt: Date | null }[]; canMerge: boolean }) {
  if (!merges.length) return <p className="text-sm text-muted-foreground">No merges.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {merges.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-2">
          <span>
            Merged <Link href={`/o/${orgSlug}/customers/${m.mergedId}`} className="font-medium hover:underline">{m.mergedName} (CUS-{m.mergedNumber})</Link> on {formatDateTime(m.createdAt)}
          </span>
          {m.revertedAt ? (
            <span className="text-xs text-muted-foreground">· reverted {formatDateTime(m.revertedAt)}</span>
          ) : (
            canMerge && (
              <ConfirmDialog
                trigger={<Button size="sm" variant="outline">Undo merge</Button>}
                title="Undo this merge?"
                description="The merged customer is restored with the emails, phones, handles, notes, addresses and consent that came from it. Fields that were filled in from it are cleared if they haven't changed since."
                confirmLabel="Undo merge"
                confirmVariant="default"
                onConfirm={() => unmergeAction(orgSlug, m.id)}
                successMessage="Merge undone"
              />
            )
          )}
        </li>
      ))}
    </ul>
  );
}
