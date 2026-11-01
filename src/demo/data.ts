import { makeRecord } from "./fixtures";
import type { Customer, Work, Source, Release } from "../core/model";
import { confirm, type RecordState, apply } from "../core/ledger";
export const REPLAY_NOW = "2026-11-02T10:00:00Z";
export const ACTOR = { id: "replay:morgan", name: "Morgan Lee" };
export const customers: Customer[] = [
  { id: "northstar", name: "Northstar", renewalOn: "2026-11-18" },
  { id: "meridian", name: "Meridian", renewalOn: "2026-12-01" },
  { id: "forma", name: "Forma", renewalOn: "2027-02-15" },
  { id: "juniper", name: "Juniper", renewalOn: "2026-12-20" },
  { id: "orbit", name: "Orbit", renewalOn: null },
  { id: "basis", name: "Basis", renewalOn: "2027-03-01" },
];
export const owners = [
  ACTOR,
  { id: "replay:elliot", name: "Elliot Park" },
  { id: "replay:sam", name: "Sam Rivera" },
];
export const releases: Release[] = [
  {
    id: "atlas-28",
    name: "Atlas 2.8",
    releaseOn: "2026-11-06",
    released: false,
    archived: false,
  },
  {
    id: "atlas-29",
    name: "Atlas 2.9",
    releaseOn: "2026-11-20",
    released: false,
    archived: false,
  },
  {
    id: "atlas-27",
    name: "Atlas 2.7",
    releaseOn: "2026-10-30",
    released: true,
    archived: false,
  },
];
function work(
  key: string,
  title: string,
  release: number,
  extra: Partial<Work> = {},
): Work {
  return {
    key,
    title,
    url: `https://demo.example/jira/browse/${key}`,
    status: "in-progress",
    cancelled: false,
    blocked: false,
    versions: [releases[release]!],
    sprint: null,
    observedAt: REPLAY_NOW,
    updatedAt: REPLAY_NOW,
    ...extra,
  };
}
export const initialWork: Work[] = [
  work("ATL-248", "Export every workspace, in one file", 0),
  work("ATL-251", "Regional data hosting", 0),
  work("ATL-260", "Single sign-on for every workspace", 1, { blocked: true }),
  work("ATL-237", "Invoice history in the customer portal", 2, {
    status: "done",
  }),
  work("ATL-265", "Workspace audit export", 1, {
    versions: [
      { ...releases[1]!, id: "undated", name: "Audit beta", releaseOn: null },
    ],
    blocked: null,
  }),
];
export function source(
  id: string,
  body: string,
  issue = "SUP-142",
  at = "2026-10-28T09:00:00Z",
): Source {
  return {
    id,
    issueKey: issue,
    body,
    public: true,
    author: owners[1]!,
    createdAt: at,
    updatedAt: at,
    url: `https://demo.example/jira/browse/${issue}?focusedCommentId=${id}`,
  };
}
export const incoming: {
  source: Source;
  customer: Customer;
  suggestedKey: string;
}[] = [
  {
    source: source(
      "c-701",
      "We will deliver the workspace export by 6 November 2026, tracked in ATL-248. I will follow up as soon as it is available.",
      "SUP-149",
      "2026-11-02T08:45:00Z",
    ),
    customer: customers[0]!,
    suggestedKey: "ATL-248",
  },
  {
    source: source(
      "c-702",
      "We will ship regional hosting in Atlas 2.8, tracked in ATL-251.",
      "SUP-151",
      "2026-11-02T09:05:00Z",
    ),
    customer: customers[4]!,
    suggestedKey: "ATL-251",
  },
  {
    source: source(
      "c-703",
      "We will aim to make audit export available in Q1 2027, tracked in ATL-265.",
      "SUP-152",
      "2026-11-02T09:20:00Z",
    ),
    customer: customers[5]!,
    suggestedKey: "ATL-265",
  },
];
export async function seed(): Promise<RecordState[]> {
  const definitions = [
    ["001", "Workspace export", 0, "ATL-248", "2026-11-06", 0],
    ["002", "Workspace export", 1, "ATL-248", "2026-11-06", 0],
    ["003", "Regional hosting", 2, "ATL-251", "2026-11-09", 1],
    ["004", "Single sign-on", 3, "ATL-260", "2026-11-06", 2],
    ["005", "Invoice history", 4, "ATL-237", "2026-10-30", 1],
    ["006", "Workspace audit export", 5, "ATL-265", "2026-11-16", 2],
    ["007", "Invoice history", 0, "ATL-237", "2026-10-30", 0],
    ["008", "Regional hosting", 3, "ATL-251", "2026-11-13", 1],
  ] as const;
  const result: RecordState[] = [];
  for (const [id, title, customer, key, dueOn, owner] of definitions) {
    const body = `We will deliver ${title.toLowerCase()} by ${dueOn}, tracked in ${key}.`;
    let record = await confirm(
      {
        id: `KPT-${id}`,
        title,
        customer: customers[customer]!,
        owner: owners[owner]!,
        source: source(`s-${id}`, body, `SUP-${140 + Number(id)}`),
        excerpt: body,
        workKeys: [key],
        dueOn,
        timezone: "Europe/Paris",
        synthetic: true,
      },
      owners[owner]!.id,
      "2026-10-28T10:00:00Z",
    );
    if (id === "007")
      record = await apply(
        record,
        {
          action: "deliver",
          at: "2026-10-30T14:30:00Z",
          url: "https://demo.example/evidence/northstar-invoice-availability",
          note: "Customer workspace availability verified after the release.",
        },
        ACTOR.id,
        "2026-10-30T15:00:00Z",
      );
    result.push(record);
  }
  return result;
}
export { makeRecord };
