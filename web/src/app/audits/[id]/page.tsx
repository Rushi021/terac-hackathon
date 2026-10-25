import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AuditReportView } from "@/components/AuditReportView";

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/audits/${id}`);
  return <AuditReportView auditId={id} />;
}
