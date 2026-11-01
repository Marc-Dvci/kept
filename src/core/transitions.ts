import { canonical } from "./json";
import type { PromiseRecord } from "./model";
type Entry = {
  data: PromiseRecord;
  action: string;
  actor: string;
  at: string;
  note: string | null;
};
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const allowed: Record<string, (keyof PromiseRecord)[]> = {
  "promise.deliver": ["delivery"],
  "promise.amend": ["dueOn", "amendments"],
  "promise.cancel": ["cancellation"],
  "promise.relink": ["owner", "workKeys"],
  "promise.acknowledge": ["alerts"],
  "alert.raised": ["alerts"],
};
/** Semantic consistency only; source truth still requires the underlying account and evidence. */
export function validTransition(
  previous: PromiseRecord | undefined,
  entry: Entry,
): boolean {
  const next = entry.data;
  if (!previous)
    return (
      entry.action === "promise.confirmed" &&
      next.confirmedAt === entry.at &&
      next.confirmedBy === entry.actor &&
      next.dueOn === next.originalDueOn &&
      !next.delivery &&
      !next.cancellation &&
      !next.amendments.length &&
      !next.alerts.length &&
      Date.parse(next.source.updatedAt) <= Date.parse(entry.at)
    );
  const permitted = allowed[entry.action];
  if (
    !permitted ||
    ((previous.delivery || previous.cancellation) &&
      entry.action !== "promise.acknowledge")
  )
    return false;
  for (const key of Object.keys(next) as (keyof PromiseRecord)[])
    if (!permitted.includes(key) && !same(previous[key], next[key]))
      return false;
  if (entry.action === "promise.deliver")
    return (
      !!next.delivery &&
      next.delivery.actor === entry.actor &&
      next.delivery.recordedAt === entry.at &&
      Date.parse(next.delivery.at) >= Date.parse(next.source.createdAt) &&
      Date.parse(next.delivery.at) <= Date.parse(entry.at)
    );
  if (entry.action === "promise.cancel")
    return (
      !!next.cancellation &&
      next.cancellation.actor === entry.actor &&
      next.cancellation.at === entry.at
    );
  if (entry.action === "promise.amend") {
    const amendment = next.amendments.at(-1);
    return (
      next.amendments.length === previous.amendments.length + 1 &&
      same(next.amendments.slice(0, -1), previous.amendments) &&
      amendment?.from === previous.dueOn &&
      amendment.to === next.dueOn &&
      amendment.from !== amendment.to &&
      amendment.actor === entry.actor &&
      amendment.at === entry.at
    );
  }
  if (entry.action === "promise.relink")
    return !!entry.note && entry.note.trim().length >= 12;
  if (entry.action === "alert.raised") {
    const alert = next.alerts.at(-1);
    return (
      next.alerts.length === previous.alerts.length + 1 &&
      same(next.alerts.slice(0, -1), previous.alerts) &&
      !!alert &&
      !previous.alerts.some((a) => a.id === alert.id) &&
      next.workKeys.includes(alert.workKey) &&
      alert.at === entry.at &&
      alert.acknowledgedAt === null &&
      alert.acknowledgedBy === null
    );
  }
  if (next.alerts.length !== previous.alerts.length) return false;
  const changed = next.alerts.flatMap((alert, i) =>
    same(alert, previous.alerts[i])
      ? []
      : [{ alert, before: previous.alerts[i]! }],
  );
  return (
    changed.length === 1 &&
    changed.every(
      ({ alert, before }) =>
        before.acknowledgedAt === null &&
        alert.acknowledgedAt === entry.at &&
        alert.acknowledgedBy === entry.actor &&
        same({ ...alert, acknowledgedAt: null, acknowledgedBy: null }, before),
    )
  );
}
