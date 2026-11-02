import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { z } from "zod";
import {
  workSchema,
  sourceSchema,
  customerSchema,
  personSchema,
  issueKey,
  type Work,
  type Source,
  type Customer,
} from "../core/model";
import { Inaccessible } from "./access";
export const settingsSchema = z.object({
  sprintField: z
    .string()
    .regex(/^(customfield_\d+)?$/)
    .default(""),
  flagField: z
    .string()
    .regex(/^(customfield_\d+)?$/)
    .default(""),
  captureProjects: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
    .max(20)
    .default([]),
});
export const getSettings = async () =>
  settingsSchema.parse((await kvs.get("kept:settings")) ?? {});
const normalized = (s: unknown): string => {
  if (typeof s !== "string" || !Number.isFinite(Date.parse(s)))
    throw new Error("Jira supplied an invalid observation timestamp");
  return new Date(s).toISOString();
};
export async function readWork(
  key: string,
  now: string,
  asApp = false,
): Promise<Work> {
  issueKey.parse(key);
  const settings = await getSettings();
  const fields = [
    "summary",
    "status",
    "resolution",
    "fixVersions",
    "updated",
    settings.sprintField,
    settings.flagField,
  ]
    .filter(Boolean)
    .join(",");
  const caller = asApp ? api.asApp() : api.asUser();
  const r = await caller.requestJira(
    route`/rest/api/3/issue/${key}?fields=${fields}&expand=versionedRepresentations`,
  );
  if (r.status === 403 || r.status === 404)
    throw new Inaccessible("A linked delivery work item is unavailable");
  if (!r.ok)
    throw new Error(`Jira delivery observation failed (HTTP ${r.status})`);
  const b = (await r.json()) as {
    fields: Record<string, any>;
    self: string;
    versionedRepresentations?: Record<string, Record<string, unknown>>;
  };
  // With expand=versionedRepresentations Jira returns only versionedRepresentations, not fields.
  const f: Record<string, any> =
    b.fields ??
    Object.fromEntries(
      Object.entries(b.versionedRepresentations ?? {}).map(([k, v]) => [
        k,
        v["1"],
      ]),
    );
  let blocked: boolean | null = null;
  let observedAt = now;
  if (settings.flagField && Object.hasOwn(f, settings.flagField))
    blocked =
      f[settings.flagField] === null
        ? false
        : Array.isArray(f[settings.flagField])
          ? f[settings.flagField].length > 0
          : null;
  if (blocked === null) {
    const property = await caller.requestJira(
      route`/rest/api/3/issue/${key}/properties/kept-planning`,
    );
    if (property.ok) {
      const value = ((await property.json()) as { value: unknown }).value;
      const parsed = z
        .object({ blocked: z.boolean(), observedAt: z.string() })
        .safeParse(value);
      if (
        parsed.success &&
        Date.parse(parsed.data.observedAt) <= Date.parse(now) &&
        Date.parse(now) - Date.parse(parsed.data.observedAt) <= 86400000
      ) {
        blocked = parsed.data.blocked;
        observedAt = new Date(Date.parse(parsed.data.observedAt)).toISOString();
      }
    } else if (property.status !== 404)
      throw new Error(
        "The blocked-state source could not be checked completely",
      );
  }
  const rawSprint = settings.sprintField
    ? (b.versionedRepresentations?.[settings.sprintField] ??
      f[settings.sprintField])
    : [];
  if (settings.sprintField && rawSprint === undefined)
    throw new Error(
      "The configured sprint field is unavailable; its planning bound could not be checked.",
    );
  const representation =
    rawSprint && !Array.isArray(rawSprint) && typeof rawSprint === "object"
      ? (rawSprint["2"] ?? rawSprint)
      : rawSprint;
  const sprintValues = representation == null ? [] : representation;
  const parsedSprints = z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        name: z.string(),
        state: z.enum(["active", "future", "closed"]),
        endDate: z.string().nullable().optional(),
      }),
    )
    .safeParse(sprintValues);
  if (!parsedSprints.success)
    throw new Error(
      "The configured sprint field has an unsupported representation; its planning bound could not be checked.",
    );
  const sprints = parsedSprints.data;
  const sprint = [...sprints]
    .filter((s) => s.state !== "closed")
    .sort(
      (a, b) => Date.parse(b.endDate ?? "") - Date.parse(a.endDate ?? ""),
    )[0];
  const web = new URL(b.self).origin;
  return workSchema.parse({
    key,
    title: f.summary,
    url: `${web}/browse/${key}`,
    status:
      f.status?.statusCategory?.key === "done"
        ? "done"
        : f.status?.statusCategory?.key === "new"
          ? "todo"
          : "in-progress",
    cancelled: /won.?t (?:do|fix)|cancel|declin|duplicate/i.test(
      f.resolution?.name ?? "",
    ),
    blocked,
    versions: (f.fixVersions ?? []).map((v: Record<string, any>) => ({
      id: String(v.id),
      name: v.name,
      releaseOn: v.releaseDate ?? null,
      released: v.released === true,
      archived: v.archived === true,
    })),
    sprint: sprint
      ? {
          id: String(sprint.id),
          name: sprint.name,
          endAt: sprint.endDate ? normalized(sprint.endDate) : null,
          state: sprint.state,
        }
      : null,
    updatedAt: normalized(f.updated),
    observedAt,
    fetchedAt: now,
  });
}
export async function readSource(
  key: string,
  commentId: string,
  asApp = false,
): Promise<{ source: Source; customer: Customer; suggestedKey: string }> {
  issueKey.parse(key);
  z.string().regex(/^\d+$/).parse(commentId);
  const caller = asApp ? api.asApp() : api.asUser();
  const r = await caller.requestJira(
    route`/rest/servicedeskapi/request/${key}/comment/${commentId}`,
  );
  if (r.status === 403 || r.status === 404)
    throw new Inaccessible("This support comment is unavailable");
  if (!r.ok)
    throw new Error(
      `The public JSM reply could not be read (HTTP ${r.status})`,
    );
  const b = (await r.json()) as Record<string, any>;
  if (b.public !== true)
    throw new Inaccessible(
      "Only public outgoing support replies may be proposed",
    );
  // The JSM comment carries no account type; Jira's user record does. A customer's own words are never
  // an outgoing commitment, whoever raised the request.
  const authorId = String(b.author?.accountId ?? "");
  const user = await caller.requestJira(
    route`/rest/api/3/user?accountId=${authorId}`,
  );
  if (!user.ok) throw new Error("The reply's author could not be checked");
  const accountType = ((await user.json()) as { accountType?: string })
    .accountType;
  if (accountType !== "atlassian")
    throw new Inaccessible(
      "Customer-authored requests are not outgoing support commitments",
    );
  const metadata = await caller.requestJira(
    route`/rest/api/3/issue/${key}/comment/${commentId}`,
  );
  if (!metadata.ok)
    throw new Error("The source comment's current metadata is unavailable");
  const m = (await metadata.json()) as Record<string, any>;
  const base = new URL(m.self).origin;
  const source = sourceSchema.parse({
    id: String(b.id),
    issueKey: key,
    body: b.body,
    public: true,
    author: {
      id: b.author?.accountId,
      name: b.author?.displayName ?? "Support author",
    },
    createdAt: normalized(
      b.created?.iso8601 ?? b.createdDate?.iso8601 ?? m.created,
    ),
    updatedAt: normalized(m.updated),
    url: `${base}/browse/${key}?focusedCommentId=${commentId}`,
  });
  let customer: Customer = {
    id: `request:${key}`,
    name: "Choose customer organisation",
    renewalOn: null,
  };
  const property = await caller.requestJira(
    route`/rest/api/3/issue/${key}/properties/kept-customer`,
  );
  if (property.ok)
    customer = customerSchema.parse(
      ((await property.json()) as { value: unknown }).value,
    );
  else if (property.status !== 404)
    throw new Error("The customer source could not be checked completely");
  const suggestedKey = source.body.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0] ?? "";
  return { source, customer, suggestedKey };
}
export async function validatePerson(person: unknown) {
  const parsed = personSchema.parse(person);
  const r = await api
    .asUser()
    .requestJira(route`/rest/api/3/user?accountId=${parsed.id}`);
  if (!r.ok)
    throw new Error("Choose an active, readable Atlassian owner account");
  const body = (await r.json()) as { active?: boolean; displayName: string };
  if (body.active === false) throw new Error("The follow-up owner is inactive");
  return { id: parsed.id, name: body.displayName };
}
