import Resolver from "@forge/resolver";
import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { z } from "zod";
import {
  actor,
  admin,
  editable,
  readable,
  bounded,
  Inaccessible,
  readScope,
  type Context,
} from "./forge/access";
import {
  getSettings,
  settingsSchema,
  readWork,
  readSource,
  validatePerson,
} from "./forge/jira";
import * as store from "./forge/store";
import { sync } from "./forge/graph";
import { sourceReferences, rememberSource } from "./forge/events";
import { loadDemo } from "./forge/demo";
import {
  confirm,
  apply,
  bundle,
  verify,
  hash,
  type Command,
  type RecordState,
} from "./core/ledger";
import { promiseSchema, issueKey, date } from "./core/model";
import { assess, preview } from "./core/forecast";
import { propose } from "./core/capture";
import { customerDraft } from "./core/draft";
export { onConnectionChange } from "./forge/graph";
export { onIssueUpdated, onPlanningChanged, onComment } from "./forge/events";
type Request = { payload: Record<string, unknown>; context: Context };
const resolver = new Resolver();
const idSchema = z.string().regex(/^KPT-[a-zA-Z0-9-]+$/);
async function profile(context: Context) {
  const who = actor(context);
  const response = await api.asUser().requestJira(route`/rest/api/3/myself`);
  if (!response.ok) throw new Error("Your Atlassian profile is unavailable");
  return {
    id: who,
    name: ((await response.json()) as { displayName: string }).displayName,
  };
}
async function authorized(
  id: string,
  context: Context,
  check = (key: string) => readable(key, context),
) {
  actor(context);
  const record = await store.read(idSchema.parse(id));
  if (!record) throw new Inaccessible("This promise is unavailable");
  const bound = context.extension?.issue?.key;
  if (
    bound &&
    record.data.source.issueKey !== bound &&
    !record.data.workKeys.includes(bound)
  )
    throw new Inaccessible(
      "Open the requested promise in its related Jira issue or the global register",
    );
  for (const key of [
    ...new Set([record.data.source.issueKey, ...record.data.workKeys]),
  ])
    await check(key);
  if (!(await verify(record)))
    throw new Error("The stored promise evidence is inconsistent");
  return record;
}
async function visible(context: Context) {
  const check = readScope(context);
  return bounded(await store.keys(), (id) => authorized(id, context, check));
}
async function observations(records: RecordState[], now: string) {
  const keys = [...new Set(records.flatMap((r) => r.data.workKeys))];
  // No stale cache can be presented as fresh Jira data. Permission failures become explicit gaps.
  return bounded(keys, (key) => readWork(key, now));
}
async function discovery(context: Context, cursor?: string) {
  actor(context);
  const page = await sourceReferences(context.extension?.issue?.key, cursor);
  const sources = await bounded(page.references, async (s) => {
    await readable(s.issueKey, context);
    return readSource(s.issueKey, s.commentId);
  });
  const keys = [
    ...new Set(
      sources.flatMap(
        (s) => s.source.body.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) ?? [],
      ),
    ),
  ].slice(0, 100);
  return {
    sources,
    sourceCursor: page.cursor,
    works: await bounded(keys, (key) =>
      readWork(key, new Date().toISOString()),
    ),
  };
}
resolver.define("bootstrap", async (req: Request) => {
  const who = await profile(req.context);
  const now = new Date().toISOString();
  const records = await visible(req.context);
  const works = await observations(records, now);
  const bound = req.context.extension?.issue?.key;
  const {
    sources,
    sourceCursor,
    works: discoveredWork,
  } = await discovery(req.context);
  works.push(
    ...discoveredWork.filter(
      (w) => !works.some((known) => known.key === w.key),
    ),
  );
  return {
    generation: "forge",
    version: 1,
    records,
    works,
    sources,
    sourceCursor,
    now,
    actor: who,
    people: [
      ...new Map(
        [who, ...records.map((r) => r.data.owner)].map((p) => [p.id, p]),
      ).values(),
    ],
    customers: [
      ...new Map(
        [
          ...records.map((r) => r.data.customer),
          ...sources.map((s) => s.customer),
        ].map((c) => [c.id, c]),
      ).values(),
    ],
    mode: "forge",
    boundKey: bound,
    graphStatus: await kvs.get("kept:graph-status"),
  };
});
resolver.define("discovery", async (req: Request) =>
  discovery(req.context, z.string().min(1).max(4096).parse(req.payload.cursor)),
);
resolver.define("source", async (req: Request) => {
  const key = issueKey.parse(req.payload.issueKey);
  const commentId = z.string().regex(/^\d+$/).parse(req.payload.commentId);
  const bound = req.context.extension?.issue?.key;
  if (bound && bound !== key)
    throw new Error(
      "Load a reply from the bound Jira request, or open the global register",
    );
  await readable(key, req.context);
  const item = await readSource(key, commentId);
  const works = await bounded(
    [
      ...new Set(item.source.body.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) ?? []),
    ].slice(0, 20),
    (workKey) => readWork(workKey, new Date().toISOString()),
  );
  await rememberSource(key, commentId);
  return { ...item, works };
});
resolver.define("confirm", async (req: Request) => {
  const sourceInput = z
    .object({ id: z.string(), issueKey })
    .parse(req.payload.source);
  const bound = req.context.extension?.issue?.key;
  if (bound && bound !== sourceInput.issueKey)
    throw new Error("Confirm this source in its own request panel");
  await editable(sourceInput.issueKey, req.context);
  const item = await readSource(sourceInput.issueKey, sourceInput.id);
  if ((await hash(item.source)) !== req.payload.expectedSourceHash)
    throw new Error(
      "The source reply changed. Reload it and review the promise again.",
    );
  const now = new Date().toISOString();
  const who = actor(req.context);
  const owner = await validatePerson(req.payload.owner);
  const proposed = promiseSchema.shape;
  const customer = proposed.customer.parse(req.payload.customer);
  if (customer.name === "Choose customer organisation")
    throw new Error(
      "Record the actual customer organisation before confirming",
    );
  const keys = [
    ...new Set(z.array(issueKey).min(1).max(20).parse(req.payload.workKeys)),
  ];
  for (const key of keys) await readable(key, req.context);
  const excerpt = z.string().parse(req.payload.excerpt);
  const versions = (await bounded(keys, (key) => readWork(key, now))).flatMap(
    (w) => w.versions,
  );
  if (
    !propose(item.source, versions, String(req.payload.timezone)).some(
      (c) => c.excerpt === excerpt,
    )
  )
    throw new Error(
      "The selected source text is no longer a recognised proposal. Reload and review it.",
    );
  const id = `KPT-${(await hash([item.source.id, item.source.issueKey, excerpt, customer.id])).slice(0, 20)}`;
  if (await store.read(id))
    throw new Error("This customer promise is already registered");
  const record = await confirm(
    {
      id,
      title: z.string().parse(req.payload.title),
      customer,
      owner,
      source: item.source,
      excerpt,
      workKeys: keys,
      dueOn: date.parse(req.payload.dueOn),
      timezone: z.string().parse(req.payload.timezone),
      synthetic: false,
    },
    who,
    now,
  );
  await store.save(record, 0);
  for (const work of await bounded(keys, (key) => readWork(key, now)))
    if (!(await store.readWorkSnapshot(work.key))) {
      try {
        await store.saveWorkSnapshot(work, 0);
      } catch {
        /* A parallel first observation can already supply the baseline. */
      }
    }
  return { id };
});
resolver.define("mutate", async (req: Request) => {
  const id = idSchema.parse(req.payload.id);
  const record = await authorized(id, req.context);
  await editable(record.data.source.issueKey, req.context);
  if (z.number().int().parse(req.payload.version) !== record.version)
    throw new Error("This promise changed. Refresh before saving.");
  const command = z
    .object({
      action: z.enum(["deliver", "amend", "cancel", "relink", "acknowledge"]),
    })
    .passthrough()
    .parse(req.payload.command) as Command;
  if (command.action === "relink") {
    for (const key of z.array(issueKey).min(1).max(20).parse(command.workKeys))
      await readable(key, req.context);
    command.owner = await validatePerson(command.owner);
  }
  const next = await apply(
    record,
    command,
    actor(req.context),
    new Date().toISOString(),
  );
  if (next !== record) await store.save(next, record.version);
  return { saved: true };
});
resolver.define("bundle", async (req: Request) => {
  const record = await authorized(idSchema.parse(req.payload.id), req.context);
  const now = new Date().toISOString();
  return bundle(record, await observations([record], now), now);
});
resolver.define("settings", async (req: Request) => {
  await admin(req.context);
  return getSettings();
});
resolver.define("saveSettings", async (req: Request) => {
  await admin(req.context);
  const settings = settingsSchema.parse(req.payload);
  await kvs.set("kept:settings", settings);
  return settings;
});
resolver.define("projects", async (req: Request) => {
  await admin(req.context);
  const r = await api
    .asUser()
    .requestJira(route`/rest/api/3/project/search?maxResults=100`);
  if (!r.ok) throw new Error("Jira projects are unavailable");
  return ((await r.json()) as { values: { key: string; name: string }[] })
    .values;
});
resolver.define("loadDemo", async (req: Request) => {
  await admin(req.context);
  return loadDemo(
    z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .parse(req.payload.project),
    await profile(req.context),
    new Date().toISOString(),
  );
});
resolver.define("syncGraph", async (req: Request) => {
  await admin(req.context);
  const records = await visible(req.context);
  return sync(
    records.filter((r) => r.data.synthetic).map((r) => r.data),
    new Date().toISOString(),
  );
});
export const handler = resolver.getDefinitions();

export async function promisesAtRisk(
  payload: { customerId: string },
  context: Context,
) {
  const customerId = z.string().min(1).max(100).parse(payload.customerId);
  const records = (await visible(context)).filter(
    (r) => r.data.customer.id === customerId,
  );
  const now = new Date().toISOString();
  const works = await observations(records, now);
  return records.map((r) => ({
    promise: r.data,
    assessment: assess(r.data, works, now),
    draft: customerDraft(r.data, works, now),
  }));
}
export async function promiseEvidence(
  payload: { promiseId: string },
  context: Context,
) {
  const record = await authorized(idSchema.parse(payload.promiseId), context);
  const now = new Date().toISOString();
  const works = await observations([record], now);
  return {
    record,
    assessment: assess(record.data, works, now),
    works,
    draft: customerDraft(record.data, works, now),
  };
}
export async function previewRelease(
  payload: { workKey: string; releaseOn: string },
  context: Context,
) {
  const key = issueKey.parse(payload.workKey);
  await readable(key, context);
  const records = await visible(context);
  const now = new Date().toISOString();
  const works = await observations(records, now);
  return preview(
    records.map((r) => r.data),
    works,
    { workKey: key, releaseOn: date.parse(payload.releaseOn) },
    now,
  );
}
