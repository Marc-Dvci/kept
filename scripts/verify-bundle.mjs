import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`;
const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export function verifyBundle(bundle, expectedHash) {
  try {
    return checkBundle(bundle, expectedHash);
  } catch {
    return { valid: false, reason: "Malformed evidence bundle" };
  }
}
function checkBundle(bundle, expectedHash) {
  const { bundleHash, ...body } = bundle;
  if (body.format !== "kept.evidence.v1" || digest(body) !== bundleHash)
    return { valid: false, reason: "Bundle digest mismatch" };
  if (expectedHash && expectedHash !== bundleHash)
    return { valid: false, reason: "Externally retained digest mismatch" };
  const r = body.record;
  if (
    !r ||
    !Array.isArray(r.events) ||
    !r.events.length ||
    r.version !== r.events.length
  )
    return { valid: false, reason: "Missing history or version mismatch" };
  let previous = "0".repeat(64);
  let time = -Infinity;
  const first = r.events[0].data;
  let prior;
  const allowed = new Set([
    "promise.confirmed",
    "promise.deliver",
    "promise.amend",
    "promise.cancel",
    "promise.relink",
    "promise.acknowledge",
    "alert.raised",
  ]);
  for (const [i, event] of r.events.entries()) {
    const { hash, ...entry } = event;
    if (
      !allowed.has(entry.action) ||
      typeof entry.actor !== "string" ||
      !entry.actor.trim() ||
      !Number.isFinite(Date.parse(entry.at)) ||
      Date.parse(entry.at) < time ||
      entry.sequence !== i + 1 ||
      entry.previousHash !== previous ||
      digest(entry) !== hash
    )
      return { valid: false, reason: `History mismatch at event ${i + 1}` };
    if (!transition(prior, entry))
      return {
        valid: false,
        reason: `Invalid state transition at event ${i + 1}`,
      };
    if (
      entry.data.id !== first.id ||
      entry.data.originalDueOn !== first.originalDueOn ||
      canonical(entry.data.source) !== canonical(first.source) ||
      entry.data.confirmedBy !== first.confirmedBy ||
      entry.data.confirmedAt !== first.confirmedAt
    )
      return { valid: false, reason: "Original commitment metadata changed" };
    if (
      i === 0 &&
      (entry.action !== "promise.confirmed" ||
        entry.actor !== entry.data.confirmedBy ||
        entry.at !== entry.data.confirmedAt)
    )
      return { valid: false, reason: "Confirmation attribution mismatch" };
    previous = hash;
    prior = entry.data;
    time = Date.parse(entry.at);
  }
  if (canonical(r.events.at(-1).data) !== canonical(r.data))
    return {
      valid: false,
      reason: "Current record differs from the recorded projection",
    };
  return {
    valid: true,
    revisionCount: r.events.length,
    bundleHash,
    externalAnchorChecked: !!expectedHash,
    note: "Hash consistency is not a qualified signature or proof of source truth. Retain the digest separately.",
  };
}
// Deliberately independent of the application's domain code and dependencies.
function transition(before, event) {
  const p = event.data;
  if (
    !p ||
    !p.source ||
    !Array.isArray(p.workKeys) ||
    !p.workKeys.length ||
    new Set(p.workKeys).size !== p.workKeys.length ||
    !Array.isArray(p.alerts) ||
    !Array.isArray(p.amendments) ||
    !p.source.body?.includes(p.excerpt)
  )
    return false;
  const equal = (a, b) => canonical(a) === canonical(b);
  if (!before)
    return (
      event.action === "promise.confirmed" &&
      !p.delivery &&
      !p.cancellation &&
      p.amendments.length === 0 &&
      p.alerts.length === 0 &&
      p.dueOn === p.originalDueOn &&
      p.confirmedBy === event.actor &&
      p.confirmedAt === event.at &&
      Date.parse(p.source.updatedAt) <= Date.parse(event.at)
    );
  const fields = {
    "promise.deliver": ["delivery"],
    "promise.cancel": ["cancellation"],
    "promise.amend": ["dueOn", "amendments"],
    "promise.relink": ["owner", "workKeys"],
    "promise.acknowledge": ["alerts"],
    "alert.raised": ["alerts"],
  }[event.action];
  if (
    !fields ||
    ((before.delivery || before.cancellation) &&
      event.action !== "promise.acknowledge")
  )
    return false;
  if (
    [...new Set([...Object.keys(before), ...Object.keys(p)])].some(
      (key) => !fields.includes(key) && !equal(before[key], p[key]),
    )
  )
    return false;
  if (event.action === "promise.deliver")
    return (
      !!p.delivery &&
      p.delivery.actor === event.actor &&
      p.delivery.recordedAt === event.at &&
      Date.parse(p.delivery.at) <= Date.parse(event.at) &&
      Date.parse(p.delivery.at) >= Date.parse(p.source.createdAt)
    );
  if (event.action === "promise.cancel")
    return (
      !!p.cancellation &&
      p.cancellation.actor === event.actor &&
      p.cancellation.at === event.at &&
      /^https?:\/\//.test(p.cancellation.agreementUrl) &&
      p.cancellation.reason?.trim().length >= 12
    );
  if (event.action === "promise.relink") return event.note?.trim().length >= 12;
  if (event.action === "promise.amend") {
    const last = p.amendments.at(-1);
    return (
      p.amendments.length === before.amendments.length + 1 &&
      equal(p.amendments.slice(0, -1), before.amendments) &&
      last.from === before.dueOn &&
      last.to === p.dueOn &&
      last.from !== last.to &&
      last.actor === event.actor &&
      last.at === event.at
    );
  }
  if (event.action === "alert.raised") {
    const last = p.alerts.at(-1);
    return (
      p.alerts.length === before.alerts.length + 1 &&
      equal(p.alerts.slice(0, -1), before.alerts) &&
      !before.alerts.some((alert) => alert.id === last.id) &&
      p.workKeys.includes(last.workKey) &&
      last.at === event.at &&
      last.acknowledgedAt === null &&
      last.acknowledgedBy === null
    );
  }
  if (p.alerts.length !== before.alerts.length) return false;
  const changed = p.alerts
    .map((alert, i) => ({ alert, old: before.alerts[i] }))
    .filter(({ alert, old }) => !equal(alert, old));
  return (
    changed.length === 1 &&
    changed.every(
      ({ alert, old }) =>
        old.acknowledgedAt === null &&
        alert.acknowledgedAt === event.at &&
        alert.acknowledgedBy === event.actor &&
        equal({ ...alert, acknowledgedAt: null, acknowledgedBy: null }, old),
    )
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const result = verifyBundle(
      JSON.parse(await readFile(process.argv[2], "utf8")),
      process.argv[3],
    );
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
