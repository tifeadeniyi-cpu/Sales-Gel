"use client";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { setLeadArchivedAction } from "../actions";

export function ArchiveLeadButton({ orgSlug, id, archived, icon }: { orgSlug: string; id: string; archived: boolean; icon: React.ReactNode }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="outline" size="sm">{icon} {archived ? "Restore" : "Archive"}</Button>}
      title={archived ? "Restore this lead?" : "Archive this lead?"}
      description={archived ? "It returns to the pipeline board." : "Archived leads are hidden from boards and reports but keep their history."}
      confirmLabel={archived ? "Restore" : "Archive"}
      confirmVariant={archived ? "default" : "destructive"}
      onConfirm={() => setLeadArchivedAction(orgSlug, id, !archived)}
      successMessage={archived ? "Lead restored" : "Lead archived"}
    />
  );
}
