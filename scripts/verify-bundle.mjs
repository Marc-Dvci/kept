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
