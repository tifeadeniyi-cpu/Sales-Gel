import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-ink",
      brand: "border-primary/20 bg-primary/10 text-primary",
      success: "border-success/20 bg-success/10 text-success",
      warning: "border-warning/20 bg-warning/10 text-warning",
      danger: "border-danger/20 bg-danger/10 text-danger",
      info: "border-info/20 bg-info/10 text-info",
      inactive: "border-inactive/20 bg-inactive/10 text-inactive",
      highlight: "border-highlight/30 bg-highlight/15 text-[#7a5a2c]",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
