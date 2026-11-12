"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setNotificationPreferenceAction } from "../actions";

export function PreferenceRow({ orgSlug, event, label, inApp, email, emailConnected }: { orgSlug: string; event: string; label: string; inApp: boolean; email: boolean; emailConnected: boolean }) {
  const [state, setState] = useState({ inApp, email });
  const [pending, start] = useTransition();
  const save = (next: { inApp: boolean; email: boolean }) => {
    const prev = state;
    setState(next);
    start(async () => {
      const res = await setNotificationPreferenceAction(orgSlug, event, next);
      if (!res.ok) { setState(prev); toast.error(res.error); }
    });
  };
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 text-sm">{label}</td>
      <td className="px-4 py-3 text-center">
        <input type="checkbox" aria-label={`In-app: ${label}`} className="size-4 accent-[var(--brand-primary)]" checked={state.inApp} disabled={pending} onChange={(e) => save({ ...state, inApp: e.target.checked })} />
      </td>
      <td className="px-4 py-3 text-center">
        <input type="checkbox" aria-label={`Email: ${label}`} className="size-4 accent-[var(--brand-primary)]" checked={state.email} disabled={pending || !emailConnected} onChange={(e) => save({ ...state, email: e.target.checked })} />
      </td>
    </tr>
  );
}
