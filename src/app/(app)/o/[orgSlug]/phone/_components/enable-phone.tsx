"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enablePhoneAction } from "../actions";

export function EnablePhoneButton({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} onClick={() => start(async () => {
      const r = await enablePhoneAction(orgSlug);
      if (r.ok) { toast.success("Phone enabled. Now buy a number."); router.push(`/o/${orgSlug}/phone/settings`); } else toast.error(r.error);
    })}>
      {pending ? "Setting up…" : "Enable phone"}
    </Button>
  );
}
