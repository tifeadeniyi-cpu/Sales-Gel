import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pagination({ page, pageCount, total, pageSize, hrefFor }: { page: number; pageCount: number; total: number; pageSize: number; hrefFor: (page: number) => string }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground">
      <span>{total === 0 ? "No results" : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}</span>
      <div className="flex gap-1">
        <Link aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} href={hrefFor(page - 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
          <ChevronLeft /> Previous
        </Link>
        <Link aria-disabled={page >= pageCount} tabIndex={page >= pageCount ? -1 : undefined} href={hrefFor(page + 1)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pageCount && "pointer-events-none opacity-50")}>
          Next <ChevronRight />
        </Link>
      </div>
    </div>
  );
}
