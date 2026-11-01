import {
  confirm,
  apply,
  raiseAlert,
  verify,
  hash,
  bundle,
  type Confirmation,
  type Command,
  type RecordState,
} from "../core/ledger";
import {
  sourceSchema,
  workSchema,
  customerSchema,
  personSchema,
  instant,
  type Source,
  type Work,
  type Customer,
  type Person,
} from "../core/model";
import { preview, type PlanChange } from "../core/forecast";
import {
  seed,
  initialWork,
  incoming,
  REPLAY_NOW,
  ACTOR,
  owners,
  customers,
} from "../demo/data";
import { z } from "zod";
export const isForge =
  /\.atlassian-dev\.net$/.test(location.hostname) &&
  parent !== window &&
  !new URLSearchParams(location.search).has("replay");
export async function invoke<T>(
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const { invoke: call } = await import("@forge/bridge");
  return (await call<T>(method, payload)) as T;
}
export type InboxSource = {
  source: Source;
  customer: Customer;
  suggestedKey: string;
  works?: Work[];
};
export type Workspace = {
  generation: string;
  version: number;
  records: RecordState[];
  works: Work[];
  sources: InboxSource[];
  now: string;
  actor: Person;
  people: Person[];
  customers: Customer[];
  mode: "replay" | "forge";
  boundKey?: string;
  focusedId?: string;
  graphStatus?: { accepted: number; at: string };
  sourceCursor?: string | null;
};
const KEY = "kept.replay.v1";
export function replayBackup() {
  return localStorage.getItem(KEY);
}
const replaySchema = z.object({
  generation: z.uuid(),
  version: z.number().int().min(1),
  records: z.array(z.unknown()).max(500),
  works: z.array(workSchema).max(10000),
  sources: z
    .array(
      z.object({
        source: sourceSchema,
        customer: customerSchema,
        suggestedKey: z.string(),
        works: z.array(workSchema).optional(),
      }),
    )
    .max(500),
  now: instant,
  actor: personSchema,
  people: z.array(personSchema).max(1000),
  customers: z.array(customerSchema).max(1000),
  mode: z.literal("replay"),
});
function save(data: Workspace) {
  localStorage.setItem(KEY, JSON.stringify(data));
}
export async function bootstrap(): Promise<Workspace> {
  if (isForge) return invoke<Workspace>("bootstrap");
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const data = replaySchema.parse(JSON.parse(raw)) as Workspace;
      if (
        new Set(data.records.map((r) => r?.data?.id)).size !==
          data.records.length ||
        new Set(data.works.map((w) => w.key)).size !== data.works.length ||
        new Set(data.customers.map((c) => c.id)).size !==
          data.customers.length ||
        new Set(data.people.map((p) => p.id)).size !== data.people.length
      )
        throw new Error();
      for (const record of data.records)
        if (!(await verify(record))) throw new Error();
      return data;
    } catch {
      throw new Error(
        "Saved replay evidence is inconsistent or unreadable. It has been preserved. Use Settings to reset the synthetic workspace.",
      );
    }
  }
  const data: Workspace = {
    generation: crypto.randomUUID(),
    version: 1,
    records: await seed(),
    works: structuredClone(initialWork),
    sources: structuredClone(incoming),
    now: REPLAY_NOW,
    actor: ACTOR,
    people: owners,
    customers,
    mode: "replay",
  };
  save(data);
  return data;
}
async function locked<T>(fn: () => Promise<T>) {
  if (!navigator.locks)
    throw new Error(
      "This browser cannot coordinate edits safely. Use a current Chrome, Edge, Firefox or Safari browser.",
    );
  return navigator.locks.request(KEY, fn);
}
export async function reset() {
  return locked(async () => {
    localStorage.removeItem(KEY);
    return bootstrap();
  });
}
export async function advance(days: number) {
  return locked(async () => {
    const data = await bootstrap();
    data.now = new Date(Date.parse(data.now) + days * 86400000).toISOString();
    data.version++;
    save(data);
    return data;
  });
}
export async function mutate(
  id: string,
  version: number,
  generation: string,
  command: Command,
): Promise<Workspace> {
  if (isForge) {
    await invoke("mutate", { id, version, command });
    return bootstrap();
  }
  return locked(async () => {
    const data = await bootstrap();
    const index = data.records.findIndex((r) => r.data.id === id);
    const record = data.records[index];
    if (generation !== data.generation || !record || record.version !== version)
      throw new Error(
        "This promise changed in another session. Refresh before saving.",
      );
    if (
      command.action === "relink" &&
      (!Array.isArray(command.workKeys) ||
        command.workKeys.some((key) => !data.works.some((w) => w.key === key)))
    )
      throw new Error("Link only delivery work available in this workspace");
    data.records[index] = await apply(record, command, data.actor.id, data.now);
    data.version++;
    save(data);
    return data;
  });
}
export async function confirmPromise(
  input: Omit<Confirmation, "id" | "synthetic">,
  expectedSourceHash: string | undefined,
  generation: string,
): Promise<Workspace> {
  if (isForge) {
    const result = await invoke<{ id: string }>("confirm", {
      ...input,
      expectedSourceHash,
    });
    return { ...(await bootstrap()), focusedId: result.id };
  }
  return locked(async () => {
    const data = await bootstrap();
    if (generation !== data.generation)
      throw new Error(
        "This workspace was reset in another session. Refresh before confirming a promise.",
      );
    sourceSchema.parse(input.source);
    if (
      data.records.some(
        (r) =>
          r.data.source.id === input.source.id &&
          r.data.excerpt === input.excerpt &&
          r.data.customer.id === input.customer.id,
      )
    )
      throw new Error(
        "This customer promise is already registered. Open its existing record.",
      );
    if (input.workKeys.some((key) => !data.works.some((w) => w.key === key)))
      throw new Error("Link only delivery work available in this workspace");
    const id = `KPT-${(await hash([input.source.id, input.excerpt, input.customer.id])).slice(0, 10)}`;
    data.records.push(
      await confirm({ ...input, id, synthetic: true }, data.actor.id, data.now),
    );
    if (!data.customers.some((c) => c.id === input.customer.id))
      data.customers.push(input.customer);
    data.version++;
    save(data);
    return { ...data, focusedId: id };
  });
}
export async function applySyntheticPlan(
  change: PlanChange,
  version: number,
  generation: string,
): Promise<Workspace> {
  if (isForge)
    throw new Error(
      "Live previews are read-only. Apply the planning decision in Jira; the issue-change event then refreshes linked promises.",
    );
  return locked(async () => {
    const data = await bootstrap();
    if (data.generation !== generation || data.version !== version)
      throw new Error(
        "The workspace changed. Refresh and review the impact again.",
      );
    const result = preview(
      data.records.map((r) => r.data),
      data.works,
      change,
      data.now,
    );
    const eventId = await hash([change, data.version, data.now]);
    for (const row of result.rows) {
      if (
        row.after.state !== "AT_RISK" &&
        row.after.state !== "UNKNOWN" &&
        row.after.state !== "BROKEN"
      )
        continue;
      if (
        row.before.state === row.after.state &&
        row.before.forecastOn === row.after.forecastOn &&
        JSON.stringify(row.before.reasons) === JSON.stringify(row.after.reasons)
      )
        continue;
      const index = data.records.findIndex((r) => r.data.id === row.promise.id);
      data.records[index] = await raiseAlert(
        data.records[index]!,
        {
          id: `${eventId}:${row.promise.id}`,
          workKey: row.promise.workKeys.find((key) =>
            result.affectedWorkKeys.includes(key),
          )!,
          reason: row.after.reasons[0]!,
        },
        "replay:planning-event",
        data.now,
      );
    }
    data.works = result.afterWorks;
    data.version++;
    save(data);
    return data;
  });
}
export async function exportBundle(id: string) {
  if (isForge)
    return invoke<Awaited<ReturnType<typeof bundle>>>("bundle", { id });
  const data = await bootstrap();
  const record = data.records.find((r) => r.data.id === id);
  if (!record) throw new Error("This promise is unavailable");
  return bundle(
    record,
    data.works.filter((w) => record.data.workKeys.includes(w.key)),
    data.now,
  );
}
export async function loadSource(
  issue: string,
  commentId: string,
): Promise<InboxSource> {
  if (!isForge)
    throw new Error("Use the synthetic reply editor in replay mode");
  return invoke<InboxSource>("source", { issueKey: issue, commentId });
}
export async function loadMoreSources(cursor: string) {
  if (!isForge) throw new Error("Discovery pages are available in Forge mode");
  return invoke<{
    sources: InboxSource[];
    sourceCursor: string | null;
    works: Work[];
  }>("discovery", { cursor });
}
