"use client";
import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setTagsAction } from "../actions";
import { TagChip } from "./tag-chip";

export function TagEditor({
  orgSlug,
  customerId,
  tags,
  allTags,
  canEdit,
}: {
  orgSlug: string;
  customerId: string;
  tags: { id: string; name: string; color: string }[];
  allTags: { id: string; name: string; color: string }[];
  canEdit: boolean;
}) {
  const [current, setCurrent] = useState(tags);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  const save = (next: { id: string; name: string; color: string }[]) => {
    const prev = current;
    setCurrent(next);
    start(async () => {
      const res = await setTagsAction(orgSlug, customerId, next.map((t) => t.name));
      if (!res.ok) { setCurrent(prev); toast.error(res.error); }
    });
  };
  const add = () => {
    const name = draft.trim();
    if (!name || current.some((t) => t.name.toLowerCase() === name.toLowerCase())) { setDraft(""); setAdding(false); return; }
    const existing = allTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    save([...current, existing ?? { id: `new-${name}`, name, color: "teal" }]);
    setDraft("");
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-busy={pending}>
      {current.length === 0 && !adding && <span className="text-sm text-muted-foreground">No tags</span>}
      {current.map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color}>
          {canEdit && (
            <button type="button" aria-label={`Remove tag ${t.name}`} onClick={() => save(current.filter((x) => x.id !== t.id))} className="-mr-0.5 rounded-full hover:bg-black/10">
              <X className="size-3" />
            </button>
          )}
        </TagChip>
      ))}
      {canEdit && (adding ? (
        <>
          <input
            autoFocus
            list={`tags-${customerId}`}
            aria-label="New tag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") setAdding(false); }}
            onBlur={add}
            className="h-6 w-32 rounded border px-2 text-xs"
            placeholder="Tag name"
          />
          <datalist id={`tags-${customerId}`}>{allTags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
          <Plus className="size-3" /> Add tag
        </button>
      ))}
    </div>
  );
}
