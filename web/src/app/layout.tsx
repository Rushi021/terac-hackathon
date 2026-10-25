import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { LogoutButton } from "@/components/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Visibility Audit",
  description: "See how often AI assistants recommend your business, and exactly why.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">AI Visibility Audit</Link>
          {user ? (
            <>
              <Link href="/dashboard">Audits</Link>
              <Link href="/billing">Billing · {user.auditCredits} credits</Link>
              {isAdmin(user) && <Link href="/admin">Studies</Link>}
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="button">Get started</Link>
            </>
          )}
        </nav>
        {children}
      </body>
    </html>
  );
}
