import { db, parseJson } from "./db";
import type { BusinessProfile } from "./audit/types";

/** What a participant sees. Brand names and domains are withheld so raters judge the questions on their own merit. */
export async function studyMaterial(studyId: string) {
  const study = await db.teracStudy.findUnique({ where: { id: studyId } });
  if (!study) return null;
  const audit = study.auditId
    ? await db.audit.findUnique({ where: { id: study.auditId }, include: { questions: true, findings: true } })
    : null;
  const profile = parseJson<BusinessProfile | null>(audit?.profile, null);
  const scrub = (s: string) => {
    if (!audit) return s;
    let out = s.split(audit.domain).join("the business's website");
    for (const n of [profile?.businessName, ...(profile?.aliases ?? [])]) if (n && n.length >= 3) out = out.split(n).join("the business");
    return out;
  };
  return {
    id: study.id,
    kind: study.kind,
    title: study.title,
    status: study.status,
    category: profile?.category ?? null,
    location: profile?.location.isLocal ? [profile.location.city, profile.location.region].filter(Boolean).join(", ") : null,
    questions: (audit?.questions ?? []).filter((q) => !q.rejectedReason).map((q) => ({ id: q.id, text: q.text })),
    findings: (audit?.findings ?? [])
      .filter((f) => f.severity !== "info")
      .slice(0, 5)
      .map((f) => ({ id: f.id, title: scrub(f.title), why: scrub(f.why), fix: scrub(f.fix) })),
  };
}

/** Share of question ratings marked realistic — the headline metric for before/after comparisons. */
export function realisticRate(payloads: string[]) {
  let yes = 0;
  let total = 0;
  for (const raw of payloads) {
    const p = parseJson<{ ratings?: { realistic: boolean }[] }>(raw, {});
    for (const r of p.ratings ?? []) {
      total++;
      if (r.realistic) yes++;
    }
  }
  return total ? yes / total : null;
}

export function averageClarity(payloads: string[]) {
  const scores = payloads.map((raw) => parseJson<{ clarity?: number }>(raw, {}).clarity).filter((n): n is number => typeof n === "number");
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
