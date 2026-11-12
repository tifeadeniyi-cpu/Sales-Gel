import { cn } from "@/lib/utils";
import { TAG_TONES } from "./labels";

export function TagChip({ name, color, className, children }: { name: string; color: string; className?: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TAG_TONES[color] ?? TAG_TONES.teal, className)}>
      {name}
      {children}
    </span>
  );
}
