import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/**
 * Where Stripe Checkout sends the customer back. This page never marks anything paid — the
 * business's records update only from Stripe's signed confirmation.
 */
export default async function PaymentCompletePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const paid = status === "paid";
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <h1 className="text-xl font-semibold">{paid ? "Thanks — your payment was submitted" : "Payment not completed"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {paid
            ? "Stripe is confirming the payment with the business. You'll get a receipt from Stripe by email once it's confirmed. You can close this page."
            : "No payment was taken. You can go back to the link the business sent you to try again."}
        </p>
      </div>
    </main>
  );
}
