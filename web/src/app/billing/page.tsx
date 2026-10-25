import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { CheckoutButton } from "@/components/CheckoutButton";

export default async function Billing({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/billing");
  const { status } = await searchParams;

  return (
    <main className="container narrow stack">
      <h1>Billing</h1>
      {status === "success" && (
        <div className="panel"><p className="good">Payment received. Credits are added as soon as Whop confirms it, usually within a few seconds — refresh if they don’t show yet.</p></div>
      )}
      <div className="panel stack">
        <p>Plan: <strong>{user.plan}</strong></p>
        <p>Audit credits: <strong>{user.auditCredits}</strong></p>
        <p className="muted small">Each payment adds {config.whop.creditsPerPayment} audits. Payments are processed securely by Whop.</p>
        <CheckoutButton />
      </div>
    </main>
  );
}
