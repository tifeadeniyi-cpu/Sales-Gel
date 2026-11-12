"use client";
import Link from "next/link";
import { Archive, ArchiveRestore, GitMerge, Pencil } from "lucide-react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { setArchivedAction } from "../actions";

export function CustomerHeaderActions({ orgSlug, id, name, status, canWrite, canArchive, canMerge }: { orgSlug: string; id: string; name: string; status: string; canWrite: boolean; canArchive: boolean; canMerge: boolean }) {
  const base = `/o/${orgSlug}/customers`;
  if (status === "merged") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canWrite && <Button asChild variant="outline" size="sm"><Link href={`${base}/${id}/edit`}><Pencil /> Edit</Link></Button>}
      {canMerge && <Button asChild variant="outline" size="sm"><Link href={`${base}/duplicates?customer=${id}`}><GitMerge /> Duplicates & merge</Link></Button>}
      {canArchive && (status === "archived" ? (
        <ConfirmDialog
          trigger={<Button variant="outline" size="sm"><ArchiveRestore /> Restore</Button>}
          title={`Restore ${name}?`}
          description="The customer will reappear in your active customer lists."
          confirmLabel="Restore"
          confirmVariant="default"
          onConfirm={() => setArchivedAction(orgSlug, id, false)}
          successMessage="Customer restored"
        />
      ) : (
        <ConfirmDialog
          trigger={<Button variant="outline" size="sm"><Archive /> Archive</Button>}
          title={`Archive ${name}?`}
          description="Archived customers are hidden from lists but keep all history. You can restore them anytime."
          confirmLabel="Archive"
          onConfirm={() => setArchivedAction(orgSlug, id, true)}
          successMessage="Customer archived"
        />
      ))}
    </div>
  );
}
