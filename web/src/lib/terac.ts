import { config } from "./config";
import { timed } from "./observe";

const BASE = "https://terac.com/api/external/v2";

async function terac<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!config.terac.apiKey) throw new Error("TERAC_API_KEY is not set");
  return timed("terac", `${method} ${path}`, async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.terac.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Terac ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as T;
  });
}

export const getContext = () => terac<Record<string, unknown>>("GET", "/organizations/current/context");

export async function ensureProject(name: string): Promise<string> {
  if (config.terac.projectId) return config.terac.projectId;
  const res = await terac<{ id?: string; data?: { id: string } }>("POST", "/projects", { name });
  const id = res.id ?? res.data?.id;
  if (!id) throw new Error("Terac did not return a project id");
  return id;
}

export type StudySpec = {
  title: string;
  description: string;
  taskUrl: string;
  numParticipants: number;
  durationMinutes: number;
};

/**
 * Creates a draft opportunity for the general population (US adults 18+).
 * Participants do the task on our hosted study page; submissions are held for
 * manual review so we only pay for answers we actually received.
 */
export async function createOpportunity(projectId: string, spec: StudySpec) {
  const res = await terac<{ id?: string; data?: { id: string; status?: string } }>("POST", "/opportunities", {
    title: spec.title,
    description: spec.description,
    project_id: projectId,
    num_participants: spec.numParticipants,
    business_type: "b2c",
    unrestricted_audience: true,
    tasks: [
      {
        sequence: 1,
        task_type: "interview",
        review_type: "manual_review",
        title: spec.title,
        description: spec.description,
        task_url: spec.taskUrl,
        duration_minutes: spec.durationMinutes,
      },
    ],
  });
  const id = res.id ?? res.data?.id;
  if (!id) throw new Error("Terac did not return an opportunity id");
  return id;
}

export const launchOpportunity = (id: string) => terac("POST", `/opportunities/${id}/launch`);
export const getOpportunity = (id: string) => terac<{ id?: string; status?: string; data?: { status: string } }>("GET", `/opportunities/${id}`);

export type TeracSubmission = { id: string; status: string; participant_id: string };

export async function listSubmissions(opportunityId: string) {
  const res = await terac<{ data: TeracSubmission[] }>("GET", `/opportunities/${opportunityId}/submissions`);
  return res.data ?? [];
}

export const approveSubmission = (id: string) => terac("POST", `/submissions/${id}/approve`);
