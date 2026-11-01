import {
  promiseSchema,
  instant,
  date,
  httpUrl,
  personSchema,
  issueKey,
  type PromiseRecord,
  type Source,
  type Customer,
  type Person,
} from "./model";
import { z } from "zod";
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  throw new Error("Evidence must be finite JSON data");
}
export async function hash(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export type Event = {
  sequence: number;
  at: string;
  actor: string;
  action: string;
  note: string | null;
  previousHash: string;
  data: PromiseRecord;
  hash: string;
};
export type RecordState = {
  version: number;
  data: PromiseRecord;
  events: Event[];
};
export async function verify(record: RecordState): Promise<boolean> {
  try {
    if (!record.events.length || record.version !== record.events.length)
      return false;
    let previous = "0".repeat(64);
    let last = -Infinity;
    const first = record.events[0]!.data;
    for (const [i, event] of record.events.entries()) {
      const { hash: stored, ...body } = event;
      const data = promiseSchema.parse(event.data);
      if (
        ![
          "promise.confirmed",
          "promise.deliver",
          "promise.amend",
          "promise.cancel",
          "promise.relink",
          "promise.acknowledge",
          "alert.raised",
        ].includes(event.action) ||
        !instant.safeParse(event.at).success ||
        typeof event.actor !== "string" ||
        !event.actor.trim() ||
        Date.parse(event.at) < last ||
        event.sequence !== i + 1 ||
        event.previousHash !== previous ||
        (await hash(body)) !== stored
      )
        return false;
      if (
        event.action === "promise.deliver" &&
        (data.delivery?.actor !== event.actor ||
          data.delivery.recordedAt !== event.at)
      )
        return false;
      if (
        event.action === "promise.cancel" &&
        (data.cancellation?.actor !== event.actor ||
          data.cancellation.at !== event.at)
      )
        return false;
      if (
        event.action === "promise.amend" &&
        (data.amendments.at(-1)?.actor !== event.actor ||
          data.amendments.at(-1)?.at !== event.at)
      )
        return false;
      if (
        data.id !== first.id ||
        data.originalDueOn !== first.originalDueOn ||
        canonical(data.source) !== canonical(first.source) ||
        data.confirmedBy !== first.confirmedBy ||
        data.confirmedAt !== first.confirmedAt
      )
        return false;
      if (
        i === 0 &&
        (event.action !== "promise.confirmed" ||
          data.confirmedBy !== event.actor ||
          data.confirmedAt !== event.at)
      )
        return false;
      previous = stored;
      last = Date.parse(event.at);
    }
    return canonical(record.events.at(-1)!.data) === canonical(record.data);
  } catch {
    return false;
  }
}
async function event(
  record: RecordState | null,
  data: PromiseRecord,
  actor: string,
  action: string,
  now: string,
  note: string | null = null,
): Promise<RecordState> {
  if (!actor.trim()) throw new Error("An authenticated actor is required");
  instant.parse(now);
  data = promiseSchema.parse(data);
  if (record && !(await verify(record)))
    throw new Error("The evidence history is inconsistent");
  if (
    record?.events.at(-1) &&
    Date.parse(now) < Date.parse(record.events.at(-1)!.at)
  )
    throw new Error("Recording times must be monotonic");
  const body = {
    sequence: (record?.version ?? 0) + 1,
    at: now,
    actor,
    action,
    note,
    previousHash: record?.events.at(-1)?.hash ?? "0".repeat(64),
    data: structuredClone(data),
  };
  return {
    version: body.sequence,
    data,
    events: [...(record?.events ?? []), { ...body, hash: await hash(body) }],
  };
}
export type Confirmation = {
  id: string;
  title: string;
  customer: Customer;
  owner: Person;
  source: Source;
  excerpt: string;
  workKeys: string[];
  dueOn: string;
  timezone: string;
  synthetic: boolean;
};
export async function confirm(
  input: Confirmation,
  actor: string,
  now: string,
): Promise<RecordState> {
  const data = promiseSchema.parse({
    ...input,
    workKeys: [...new Set(input.workKeys)],
    originalDueOn: input.dueOn,
    confirmedAt: now,
    confirmedBy: actor,
    delivery: null,
    cancellation: null,
    amendments: [],
    alerts: [],
  });
  if (Date.parse(data.source.updatedAt) > Date.parse(now))
    throw new Error("The source reply is dated in the future");
  return event(null, data, actor, "promise.confirmed", now);
}
function open(data: PromiseRecord) {
  if (data.delivery || data.cancellation)
    throw new Error(
      "This promise is closed; retain its evidence and create a new promise if needed",
    );
}
export type Command = {
  action: "deliver" | "amend" | "cancel" | "relink" | "acknowledge";
  [key: string]: unknown;
};
export async function apply(
  record: RecordState,
  input: Command,
  actor: string,
  now: string,
): Promise<RecordState> {
  const data = structuredClone(record.data);
  if (input.action !== "acknowledge") open(data);
  if (input.action === "deliver") {
    const parsed = z
      .object({
        at: instant,
        url: httpUrl,
        note: z.string().trim().min(12).max(1000),
      })
      .parse(input);
    if (
      Date.parse(parsed.at) > Date.parse(now) ||
      Date.parse(parsed.at) < Date.parse(data.source.createdAt)
    )
      throw new Error("Delivery time must be between the source reply and now");
    data.delivery = { ...parsed, actor, recordedAt: now };
  } else if (input.action === "amend") {
    const parsed = z
      .object({
        dueOn: date,
        agreementUrl: httpUrl,
        reason: z.string().trim().min(12).max(1000),
      })
      .parse(input);
    if (parsed.dueOn === data.dueOn)
      throw new Error("The agreed date has not changed");
    data.amendments.push({
      from: data.dueOn,
      to: parsed.dueOn,
      at: now,
      actor,
      agreementUrl: parsed.agreementUrl,
      reason: parsed.reason,
    });
    data.dueOn = parsed.dueOn;
  } else if (input.action === "cancel") {
    data.cancellation = {
      at: now,
      actor,
      agreementUrl: httpUrl.parse(input.agreementUrl),
      reason: z.string().trim().min(12).max(1000).parse(input.reason),
    };
  } else if (input.action === "relink") {
    const parsed = z
      .object({
        workKeys: z.array(issueKey).min(1).max(20),
        owner: personSchema,
      })
      .parse(input);
    z.string().trim().min(12).max(1000).parse(input.reason);
    data.workKeys = [...new Set(parsed.workKeys)];
    data.owner = parsed.owner;
  } else if (input.action === "acknowledge") {
    const alert = data.alerts.find((a) => a.id === input.alertId);
    if (!alert) throw new Error("This alert is unavailable");
    if (alert.acknowledgedAt) return record;
    alert.acknowledgedAt = now;
    alert.acknowledgedBy = actor;
  } else throw new Error("Unsupported promise action");
  return event(
    record,
    data,
    actor,
    `promise.${input.action}`,
    now,
    typeof input.reason === "string" ? input.reason : null,
  );
}
export async function raiseAlert(
  record: RecordState,
  input: { id: string; workKey: string; reason: string },
  actor: string,
  now: string,
) {
  if (
    record.data.delivery ||
    record.data.cancellation ||
    record.data.alerts.some((a) => a.id === input.id)
  )
    return record;
  const data = structuredClone(record.data);
  data.alerts.push({
    ...input,
    at: now,
    acknowledgedAt: null,
    acknowledgedBy: null,
  });
  return event(record, data, actor, "alert.raised", now);
}
export async function bundle(
  record: RecordState,
  works: unknown[],
  now: string,
) {
  if (!(await verify(record)))
    throw new Error("The evidence history is inconsistent");
  const body = { format: "kept.evidence.v1", exportedAt: now, record, works };
  return { ...body, bundleHash: await hash(body) };
}
