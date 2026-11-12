import { cn, initials } from "@/lib/utils";

export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-semibold text-primary",
        className,
      )}
      aria-hidden={!name}
      title={name ?? undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
