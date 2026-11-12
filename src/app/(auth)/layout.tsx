export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">CC</span>
        <span className="text-lg font-semibold text-ink">Commerce CRM</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
