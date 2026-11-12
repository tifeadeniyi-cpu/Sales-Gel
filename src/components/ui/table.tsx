import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export const THead = (p: React.ComponentProps<"thead">) => <thead className="border-b bg-muted/50" {...p} />;
export const TBody = (p: React.ComponentProps<"tbody">) => <tbody className="divide-y" {...p} />;
export const TR = ({ className, ...p }: React.ComponentProps<"tr">) => <tr className={cn("hover:bg-muted/30", className)} {...p} />;
export const TH = ({ className, ...p }: React.ComponentProps<"th">) => (
  <th className={cn("h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground", className)} {...p} />
);
export const TD = ({ className, ...p }: React.ComponentProps<"td">) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;
