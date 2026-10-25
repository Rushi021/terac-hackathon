import { StudyForm } from "@/components/StudyForm";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  return <StudyForm studyId={(await params).id} />;
}
