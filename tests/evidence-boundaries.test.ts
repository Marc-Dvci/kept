import { describe, it, expect } from "vitest";
import { seed, ACTOR, REPLAY_NOW } from "../src/demo/data";
import {
  apply,
  hash,
  verify,
  bundle,
  type RecordState,
} from "../src/core/ledger";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
async function rehash(record: RecordState) {
  let previous = "0".repeat(64);
  for (const event of record.events) {
    event.previousHash = previous;
    const { hash: ignored, ...body } = event;
    previous = event.hash = await hash(body);
  }
  record.data = structuredClone(record.events.at(-1)!.data);
  return record;
}
async function amendment() {
  return apply(
    (await seed())[0]!,
    {
      action: "amend",
      dueOn: "2026-11-13",
      agreementUrl: "https://example.com/agreement",
      reason: "The customer agreed the changed date after review.",
    },
    ACTOR.id,
    REPLAY_NOW,
  );
}
describe("semantic evidence boundaries", () => {
  it("rejects a rehashed acknowledgment that changes the commitment date", async () => {
    const record = await amendment();
    record.events[1]!.action = "promise.acknowledge";
    expect(await verify(await rehash(record))).toBe(false);
  });
  it("preserves the original timezone and excerpt through amendments", async () => {
    const record = await amendment();
    record.events[1]!.data.timezone = "America/New_York";
    expect(await verify(await rehash(record))).toBe(false);
  });
  it("does not allow a confirmation to contain an already delivered outcome", async () => {
    const record = (await seed())[0]!;
    record.events[0]!.data.delivery = {
      at: REPLAY_NOW,
      recordedAt: REPLAY_NOW,
      actor: ACTOR.id,
      url: "https://example.com/evidence",
      note: "Customer availability was recorded.",
    };
    expect(await verify(await rehash(record))).toBe(false);
  });
  it("applies the same transition boundary in the independent verifier", async () => {
    const record = await amendment();
    const exported = await bundle(record, [], REPLAY_NOW);
    exported.record.events[1]!.action = "promise.acknowledge";
    await rehash(exported.record);
    const { bundleHash: ignored, ...body } = exported;
    exported.bundleHash = await hash(body);
    mkdirSync(".local", { recursive: true });
    const file = ".local/invalid-transition.json";
    writeFileSync(file, JSON.stringify(exported));
    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/verify-bundle.mjs", file],
        { encoding: "utf8" },
      );
      expect(result.status).toBe(1);
    } finally {
      unlinkSync(file);
    }
  });
});
