import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-muted/40">
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="flex items-center justify-center gap-2 pb-6 text-xs text-muted-foreground">
        Support by <Link href="/" className="inline-flex items-center opacity-80 hover:opacity-100" aria-label="SalesGel"><Logo className="h-4 w-auto" /></Link>
      </footer>
    </div>
  );
}
