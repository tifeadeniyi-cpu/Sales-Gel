import Image from "next/image";
import { cn } from "@/lib/utils";

/** SalesGel logo: the brand mark plus the two-tone wordmark. `tone="dark"` for navy backgrounds. */
export function Logo({ tone = "light", collapsed, className }: { tone?: "light" | "dark"; collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image src="/salesgel-mark.png" alt={collapsed ? "SalesGel" : ""} width={28} height={32} priority className="h-7 w-auto shrink-0" />
      {!collapsed && (
        <span className="text-xl font-bold tracking-tight">
          <span className={tone === "dark" ? "text-white" : "text-ink"}>Sales</span>
          <span className={tone === "dark" ? "text-accent" : "text-teal-ink"}>Gel</span>
        </span>
      )}
    </span>
  );
}
