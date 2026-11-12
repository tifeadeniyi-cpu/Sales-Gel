"use client";
import { Pin, PinOff, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatRelative } from "@/lib/utils";
import { addNoteAction, deleteNoteAction, updateNoteAction } from "../actions";

export interface NoteView {
  id: string;
  body: string;
  pinned: boolean;
  createdAt: Date;
  authorUserId: string | null;
  authorName: string | null;
}

export function NotesPanel({ orgSlug, customerId, notes, currentUserId, canWrite, canDeleteAny }: { orgSlug: string; customerId: string; notes: NoteView[]; currentUserId: string; canWrite: boolean; canDeleteAny: boolean }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="space-y-4">
      {canWrite && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addNoteAction(orgSlug, customerId, body);
              if (res.ok) { setBody(""); setError(null); toast.success("Note added"); }
              else setError(res.fieldErrors?.body?.[0] ?? res.error);
            });
          }}
          className="grid gap-2"
        >
          <label htmlFor={`note-${customerId}`} className="sr-only">New note</label>
          <Textarea id={`note-${customerId}`} ref={ref} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for your team…" rows={3} aria-invalid={!!error} />
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={pending || !body.trim()}>{pending ? "Saving…" : "Add note"}</Button></div>
        </form>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className={`rounded-md border p-3 ${n.pinned ? "border-highlight/40 bg-highlight/5" : ""}`}>
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-ink">{n.authorName ?? "Former member"}</span>
                <span>{formatRelative(n.createdAt)}</span>
                {n.pinned && <span className="inline-flex items-center gap-0.5 text-[#7a5a2c]"><Pin className="size-3" /> Pinned</span>}
                {canWrite && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="rounded p-1 hover:bg-muted" aria-label={n.pinned ? "Unpin note" : "Pin note"} onClick={() => start(async () => { const r = await updateNoteAction(orgSlug, n.id, { pinned: !n.pinned }); if (!r.ok) toast.error(r.error); })}>
                      {n.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    </button>
                    {(n.authorUserId === currentUserId || canDeleteAny) && (
                      <ConfirmDialog
                        trigger={<button type="button" className="rounded p-1 hover:bg-muted" aria-label="Delete note"><Trash2 className="size-3.5" /></button>}
                        title="Delete this note?"
                        description="The note is removed for everyone. Its deletion is recorded in the customer timeline."
                        confirmLabel="Delete"
                        onConfirm={() => deleteNoteAction(orgSlug, n.id)}
                        successMessage="Note deleted"
                      />
                    )}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
