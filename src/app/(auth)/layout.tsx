import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-6"><Logo /></div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
