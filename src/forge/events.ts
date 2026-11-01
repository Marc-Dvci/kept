import { kvs } from "@forge/kvs";
import { issueKey, type Work } from "../core/model";
import { assess } from "../core/forecast";
import { hash, raiseAlert } from "../core/ledger";
import { readWork, readSource, getSettings } from "./jira";
import { Inaccessible } from "./access";
import { WhereConditions } from "@forge/kvs";
import * as store from "./store";
export async function onIssueUpdated(event: {
  issue?: { key?: string };
  selfGenerated?: boolean;
}) {
  if (event.selfGenerated) return;
  const key = issueKey.parse(event.issue?.key);
  const ids = await store.linkedIds(key);
  const linked = [];
  for (const id of ids) {
    const r = await store.read(id);
    if (
      r &&
      !r.data.delivery &&
      !r.data.cancellation &&
      r.data.workKeys.includes(key)
    )
      linked.push(r);
  }
  if (!linked.length) return;
  const now = new Date().toISOString();
  // Fetch current canonical data; delayed event payloads cannot roll a plan back.
  const observation = await readWork(key, now, true);
  const storedWork = await store.readWorkSnapshot(key);
  const prior = storedWork?.data;
  if (
    prior &&
    (Date.parse(prior.updatedAt) > Date.parse(observation.updatedAt) ||
      Date.parse(prior.fetchedAt ?? prior.observedAt) >
        Date.parse(observation.fetchedAt ?? observation.observedAt))
  )
    return;
  const eventId = await hash([
    key,
    storedWork?.version ?? 0,
    observation.updatedAt,
    observation.versions,
    observation.blocked,
    observation.status,
    observation.cancelled,
    observation.sprint,
  ]);
  for (const record of linked) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await store.read(record.data.id);
      if (
        !fresh ||
        fresh.data.delivery ||
        fresh.data.cancellation ||
        !fresh.data.workKeys.includes(key)
      )
        break;
      if (fresh.data.alerts.some((a) => a.id === eventId)) break;
      const others: Work[] = [];
      for (const other of fresh.data.workKeys.filter((k) => k !== key)) {
        const w = await store.readWorkSnapshot(other);
        if (w) others.push(w.data);
      }
      const after = assess(fresh.data, [...others, observation], now);
      const before = assess(
        fresh.data,
        [...others, ...(prior ? [prior] : [])],
        now,
      );
      if (
        !["AT_RISK", "BROKEN", "UNKNOWN"].includes(after.state) ||
        (before.state === after.state &&
          before.forecastOn === after.forecastOn &&
          JSON.stringify(before.reasons) === JSON.stringify(after.reasons))
      )
        break;
      const next = await raiseAlert(
        fresh,
        { id: eventId, workKey: key, reason: after.reasons[0]! },
        "forge:issue-change",
        now,
      );
      if (next === fresh) break;
      try {
        await store.save(next, fresh.version);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await store.readWorkSnapshot(key);
    if (
      latest &&
      (Date.parse(latest.data.updatedAt) > Date.parse(observation.updatedAt) ||
        Date.parse(latest.data.fetchedAt ?? latest.data.observedAt) >
          Date.parse(observation.fetchedAt ?? observation.observedAt))
    )
      return;
    try {
      await store.saveWorkSnapshot(observation, latest?.version ?? 0);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}
export async function onPlanningChanged(event: {
  version?: { id?: string | number };
  sprint?: { id?: string | number };
}) {
  const id = event.version?.id ?? event.sprint?.id;
  if (id === undefined)
    throw new Error("A planning event identifier is required");
  const keys = new Set<string>();
  for (const promiseId of await store.keys()) {
    const record = await store.read(promiseId);
    if (!record || record.data.delivery || record.data.cancellation) continue;
    for (const key of record.data.workKeys) {
      const stored = await store.readWorkSnapshot(key);
      if (
        (event.version &&
          stored?.data.versions.some((v) => v.id === String(id))) ||
        (event.sprint && stored?.data.sprint?.id === String(id))
      )
        keys.add(key);
    }
  }
  for (const key of keys) await onIssueUpdated({ issue: { key } });
}
export async function onComment(event: {
  issue?: { key?: string };
  comment?: { id?: string };
  selfGenerated?: boolean;
}) {
  if (event.selfGenerated) return;
  const key = issueKey.parse(event.issue?.key);
  const commentId = String(event.comment?.id ?? "");
  if (
    !/^\d+$/.test(commentId) ||
    !(await getSettings()).captureProjects.includes(key.split("-")[0]!)
  )
    return;
  try {
    await readSource(key, commentId, true);
  } catch (error) {
    if (error instanceof Inaccessible) return;
    throw error;
  }
  // Discovery stores references only. Every view and confirmation re-reads as the user.
  await rememberSource(key, commentId);
}
export async function rememberSource(key: string, commentId: string) {
  await kvs.set(
    `kept:source:${key}:${commentId}`,
    {
      issueKey: key,
      commentId,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
    },
    { ttl: { value: 30, unit: "DAYS" } },
  );
}
export async function sourceReferences(boundKey?: string, cursor?: string) {
  const prefix = boundKey
    ? `kept:source:${issueKey.parse(boundKey)}:`
    : "kept:source:";
  const query = kvs
    .query()
    .where("key", WhereConditions.beginsWith(prefix))
    .limit(20);
  const page = await (cursor ? query.cursor(cursor) : query).getMany<{
    issueKey: string;
    commentId: string;
    expiresAt?: string;
  }>();
  return {
    references: page.results
      .map((r) => r.value)
      .filter((r) => !r.expiresAt || Date.parse(r.expiresAt) > Date.now()),
    cursor: page.nextCursor ?? null,
  };
}
