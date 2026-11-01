import type { PromiseRecord, Work } from "../core/model";
export const EVAL_NOW = "2026-11-01T10:00:00Z";
export function makeRecord(patch: Record<string, unknown> = {}): {
  promise: PromiseRecord;
  works: Work[];
  now: string;
} {
  const p: PromiseRecord = {
    id: "KPT-test",
    title: "Workspace export",
    customer: { id: "customer", name: "Test customer", renewalOn: null },
    owner: { id: "officer", name: "Test owner" },
    source: {
      id: "comment-1",
      issueKey: "SUP-1",
      body: "We will deliver by 2026-11-06.",
      public: true,
      author: { id: "agent", name: "Test agent" },
      createdAt: "2026-10-28T09:00:00Z",
      updatedAt: "2026-10-28T09:00:00Z",
      url: "https://example.com/source",
    },
    excerpt: "We will deliver by 2026-11-06.",
    workKeys: ["ATL-1"],
    originalDueOn: String(patch.dueOn ?? "2026-11-06"),
    dueOn: String(patch.dueOn ?? "2026-11-06"),
    timezone: String(patch.timezone ?? "Europe/Paris"),
    confirmedAt: "2026-10-28T10:00:00Z",
    confirmedBy: "officer",
    synthetic: true,
    delivery: null,
    cancellation: null,
    amendments: [],
    alerts: [],
  };
  const now = String(patch.now ?? EVAL_NOW);
  if (patch.deliveredAt)
    p.delivery = {
      at: String(patch.deliveredAt),
      actor: "officer",
      recordedAt: now,
      url: "https://example.com/delivery",
      note: "Customer availability explicitly verified.",
    };
  if (patch.cancelled)
    p.cancellation = {
      at: now,
      actor: "officer",
      agreementUrl: "https://example.com/withdrawal-agreement",
      reason: "The customer withdrew the request.",
    };
  const work: Work = {
    key: "ATL-1",
    title: "Export",
    url: "https://example.com/work",
    status: (patch.status as Work["status"]) ?? "in-progress",
    cancelled: patch.workCancelled === true,
    blocked: Object.hasOwn(patch, "blocked")
      ? (patch.blocked as boolean | null)
      : false,
    versions: patch.noVersions
      ? []
      : [
          {
            id: "v1",
            name: "Atlas 2.8",
            releaseOn: Object.hasOwn(patch, "releaseOn")
              ? (patch.releaseOn as string | null)
              : "2026-11-06",
            released: false,
            archived: false,
          },
        ],
    sprint: patch.sprintEnd
      ? {
          id: "s1",
          name: "Sprint 8",
          endAt: String(patch.sprintEnd),
          state: "active",
        }
      : null,
    observedAt: String(patch.observedAt ?? EVAL_NOW),
    updatedAt: EVAL_NOW,
  };
  const works = patch.missingWork ? [] : [work];
  if (patch.extraMissingWork) p.workKeys.push("ATL-2");
  if (patch.secondReleaseOn) {
    p.workKeys.push("ATL-2");
    works.push({
      ...structuredClone(work),
      key: "ATL-2",
      versions: [
        { ...work.versions[0]!, releaseOn: String(patch.secondReleaseOn) },
      ],
    });
  }
  return { promise: p, works, now };
}
