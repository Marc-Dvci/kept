import { Temporal } from "@js-temporal/polyfill";
import {
  endOfDay,
  localDay,
  promiseSchema,
  workSchema,
  instant,
  RULE_VERSION,
  MAX_AGE_HOURS,
  type Assessment,
  type PromiseRecord,
  type Work,
  type State,
} from "./model";

function evaluate(
  p: PromiseRecord,
  works: Work[],
  now: string,
  dueOn: string,
): Omit<Assessment, "originalState" | "originalDueOn" | "ruleVersion"> {
  const deadlineAt = endOfDay(dueOn, p.timezone);
  const result = (
    state: State,
    reasons: string[],
    forecastOn: string | null = null,
  ) => ({ state, reasons, deadlineAt, forecastOn });
  if (p.cancellation)
    return result("CANCELLED", [
      "Promise withdrawn with a recorded rationale.",
    ]);
  if (p.delivery) {
    if (Date.parse(p.delivery.at) > Date.parse(now))
      return result("UNKNOWN", [
        "Customer delivery evidence is dated in the future.",
      ]);
    return Date.parse(p.delivery.at) <= Date.parse(deadlineAt)
      ? result("KEPT", [
          "Customer availability was explicitly recorded on or before the promised date.",
        ])
      : result("BROKEN", [
          "Customer availability was recorded after the promised date. Delivery was late.",
        ]);
  }
  if (Date.parse(now) > Date.parse(deadlineAt))
    return result("BROKEN", [
      "The promised date passed without recorded customer availability.",
    ]);
  const risks: string[] = [];
  const gaps: string[] = [];
  const bounds: string[] = [];
  const currentDay = localDay(now, p.timezone);
  for (const key of p.workKeys) {
    const w = works.find((x) => x.key === key);
    if (!w) {
      gaps.push(`${key}: no accessible delivery observation.`);
      continue;
    }
    workSchema.parse(w);
    const age = Date.parse(now) - Date.parse(w.observedAt);
    if (age < 0 || age > MAX_AGE_HOURS * 3600000) {
      gaps.push(`${key}: delivery observation is stale or future-dated.`);
      continue;
    }
    if (w.cancelled) risks.push(`${key}: required delivery work is cancelled.`);
    if (w.blocked === true) risks.push(`${key}: delivery work is blocked.`);
    if (w.blocked === null)
      gaps.push(`${key}: blocked state has not been established.`);
    if (w.status === "done") {
      risks.push(
        `${key}: Jira work is done; customer availability still needs evidence.`,
      );
      continue;
    }
    const versions = w.versions.filter((v) => !v.archived);
    const dates: string[] = versions.flatMap((v) =>
      v.releaseOn ? [v.releaseOn] : [],
    );
    if (versions.some((v) => !v.releaseOn))
      gaps.push(`${key}: a linked release has no date.`);
    if (w.sprint && w.sprint.state !== "closed") {
      if (w.sprint.endAt) dates.push(localDay(w.sprint.endAt, p.timezone));
      else gaps.push(`${key}: the active/future sprint has no end date.`);
    }
    if (!dates.length) gaps.push(`${key}: no usable release or sprint date.`);
    for (const on of dates) {
      bounds.push(on);
      if (on > dueOn)
        risks.push(
          `${key}: current planning date ${on} is after the promise ${dueOn}.`,
        );
      else if (on < currentDay)
        risks.push(
          `${key}: planning date ${on} has elapsed while work remains open.`,
        );
    }
  }
  const forecastOn = bounds.sort().at(-1) ?? null;
  if (risks.length)
    return result("AT_RISK", [...new Set([...risks, ...gaps])], forecastOn);
  if (gaps.length) return result("UNKNOWN", [...new Set(gaps)], forecastOn);
  return result(
    "ON_TRACK",
    [
      "Fresh, unblocked delivery plans fit the promised date. This is a planning signal, not a guarantee.",
    ],
    forecastOn,
  );
}
export function assess(
  input: PromiseRecord,
  works: Work[],
  now: string,
): Assessment {
  const p = promiseSchema.parse(input);
  instant.parse(now);
  const current = evaluate(p, works, now, p.dueOn);
  const original =
    p.dueOn === p.originalDueOn
      ? current
      : evaluate(p, works, now, p.originalDueOn);
  return {
    ...current,
    originalState:
      p.cancellation &&
      Date.parse(p.cancellation.at) >
        Date.parse(endOfDay(p.originalDueOn, p.timezone))
        ? "BROKEN"
        : original.state,
    originalDueOn: p.originalDueOn,
    ruleVersion: RULE_VERSION,
  };
}
export type PlanChange = {
  workKey: string;
  releaseOn?: string | null;
  blocked?: boolean;
  sprintEnd?: string | null;
};
export function changedWork(work: Work, change: PlanChange, now: string): Work {
  const next = structuredClone(work);
  if (Object.hasOwn(change, "releaseOn")) {
    const current = next.versions.filter((v) => !v.archived && !v.released);
    if (current.length !== 1)
      throw new Error(
        "Choose work with exactly one unreleased version for this release-date preview",
      );
    current[0]!.releaseOn = change.releaseOn ?? null;
  }
  if (Object.hasOwn(change, "blocked")) next.blocked = change.blocked!;
  if (Object.hasOwn(change, "sprintEnd")) {
    if (!next.sprint || next.sprint.state === "closed")
      throw new Error(
        "No active or future sprint is available for this preview",
      );
    next.sprint.endAt = change.sprintEnd ?? null;
  }
  next.updatedAt = now;
  return workSchema.parse(next);
}
export function preview(
  promises: PromiseRecord[],
  works: Work[],
  change: PlanChange,
  now: string,
) {
  const target = works.find((w) => w.key === change.workKey);
  if (!target) throw new Error("The selected delivery work is unavailable");
  const updated = changedWork(target, change, now);
  const impactedKeys = Object.hasOwn(change, "releaseOn")
    ? new Set(
        works
          .filter((w) =>
            w.versions.some((v) =>
              updated.versions.some(
                (u) => !u.archived && !u.released && u.id === v.id,
              ),
            ),
          )
          .map((w) => w.key),
      )
    : new Set([target.key]);
  const afterWorks = works.map((w) => {
    if (!impactedKeys.has(w.key)) return w;
    if (w.key === target.key) return updated;
    return workSchema.parse({
      ...w,
      updatedAt: now,
      versions: w.versions.map(
        (v) => updated.versions.find((u) => u.id === v.id) ?? v,
      ),
    });
  });
  const rows = promises
    .filter(
      (p) =>
        !p.delivery &&
        !p.cancellation &&
        p.workKeys.some((k) => impactedKeys.has(k)),
    )
    .map((promise) => ({
      promise,
      before: assess(promise, works, now),
      after: assess(promise, afterWorks, now),
    }));
  const customers = [
    ...new Map(
      rows.map((r) => [r.promise.customer.id, r.promise.customer]),
    ).values(),
  ];
  const today = Temporal.PlainDate.from(localDay(now, "Europe/Paris"));
  const end = today.add({ days: 60 }).toString();
  return {
    rows,
    afterWorks,
    affected: rows.length,
    customers: customers.length,
    newlyAtRisk: rows.filter(
      (r) => r.before.state === "ON_TRACK" && r.after.state === "AT_RISK",
    ).length,
    renewals: customers.filter(
      (c) =>
        c.renewalOn && c.renewalOn >= today.toString() && c.renewalOn <= end,
    ).length,
    unknownRenewals: customers.filter((c) => !c.renewalOn).length,
    scope:
      "Visible confirmed promises only. A shared version change affects all linked delivery items in this observation set. Renewal window uses Paris calendar dates.",
  };
}
