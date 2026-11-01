import { describe, it, expect } from "vitest";
import { seed, REPLAY_NOW, ACTOR } from "../src/demo/data";
import {
  apply,
  verify,
  raiseAlert,
  bundle,
  confirm,
  hash,
} from "../src/core/ledger";
import { assess } from "../src/core/forecast";
import { initialWork } from "../src/demo/data";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
const first = async () => (await seed())[0]!;
describe("promise history and human evidence", () => {
  it("requires customer evidence before a withdrawal can close a promise", async () => {
    await expect(
      apply(
        await first(),
        { action: "cancel", reason: "The customer withdrew this request." },
        ACTOR.id,
        REPLAY_NOW,
      ),
    ).rejects.toThrow();
  });
  it("checks the full current projection", async () => {
    const r = await first();
    expect(await verify(r)).toBe(true);
    r.data.title = "Changed without an event";
    expect(await verify(r)).toBe(false);
  });
  it("detects a modified event snapshot", async () => {
    const r = await first();
    r.events[0]!.data.dueOn = "2026-12-31";
    expect(await verify(r)).toBe(false);
  });
  it("does not mutate previous snapshots when recording delivery", async () => {
    const r = await first();
    const before = await hash(r);
    const next = await apply(
      r,
      {
        action: "deliver",
        at: REPLAY_NOW,
        url: "https://example.com/available",
        note: "Customer availability verified against the released workspace.",
      },
      ACTOR.id,
      REPLAY_NOW,
    );
    expect(await hash(r)).toBe(before);
    expect(await verify(next)).toBe(true);
    expect(assess(next.data, initialWork, REPLAY_NOW).state).toBe("KEPT");
  });
  it("rejects future delivery", async () =>
    await expect(
      apply(
        await first(),
        {
          action: "deliver",
          at: "2027-01-01T00:00:00Z",
          url: "https://example.com",
          note: "Customer availability was checked.",
        },
        ACTOR.id,
        REPLAY_NOW,
      ),
    ).rejects.toThrow("Delivery time"));
  it("requires evidence rather than a Done inference", async () =>
    await expect(
      apply(
        await first(),
        { action: "deliver", at: REPLAY_NOW, url: "", note: "Done" },
        ACTOR.id,
        REPLAY_NOW,
      ),
    ).rejects.toThrow());
  it("retains the original commitment and customer agreement", async () => {
    const r = await first();
    const next = await apply(
      r,
      {
        action: "amend",
        dueOn: "2026-11-13",
        agreementUrl: "https://example.com/agreement",
        reason: "The customer agreed the later availability date in the reply.",
      },
      ACTOR.id,
      REPLAY_NOW,
    );
    expect(next.data.originalDueOn).toBe("2026-11-06");
    expect(next.data.amendments[0]!.from).toBe("2026-11-06");
    expect(await verify(next)).toBe(true);
  });
  it("rejects later revisions after a delivery closes the promise", async () => {
    const r = (await seed())[6]!;
    await expect(
      apply(
        r,
        {
          action: "cancel",
          agreementUrl: "https://example.com/customer-withdrawal",
          reason: "Trying to remove evidence after delivery.",
        },
        ACTOR.id,
        REPLAY_NOW,
      ),
    ).rejects.toThrow("closed");
  });
  it("requires a real source excerpt", async () => {
    const r = await first();
    await expect(
      confirm(
        { ...r.data, excerpt: "Approved by the CEO" },
        ACTOR.id,
        REPLAY_NOW,
      ),
    ).rejects.toThrow("excerpt");
  });
  it("cannot choose an actor from a command payload", async () => {
    const next = await apply(
      await first(),
      {
        action: "cancel",
        agreementUrl: "https://example.com/customer-withdrawal",
        reason: "The customer withdrew this delivery request.",
        actor: "forged",
      },
      ACTOR.id,
      REPLAY_NOW,
    );
    expect(next.data.cancellation?.actor).toBe(ACTOR.id);
  });
  it("requires monotonic recording times", async () => {
    const r = await apply(
      await first(),
      {
        action: "cancel",
        agreementUrl: "https://example.com/customer-withdrawal",
        reason: "Customer request was formally withdrawn.",
      },
      ACTOR.id,
      REPLAY_NOW,
    );
    await expect(
      apply(
        r,
        { action: "acknowledge", alertId: "none" },
        ACTOR.id,
        "2026-10-27T00:00:00Z",
      ),
    ).rejects.toThrow();
  });
  it("records a work-link correction rationale", async () => {
    const r = await apply(
      await first(),
      {
        action: "relink",
        workKeys: ["ATL-251"],
        owner: ACTOR,
        reason:
          "Corrected the linked delivery work after checking the support reply.",
      },
      ACTOR.id,
      REPLAY_NOW,
    );
    expect(r.events.at(-1)!.note).toContain("Corrected");
    expect(await verify(r)).toBe(true);
  });
  it("deduplicates a repeated planning event and records review attribution", async () => {
    const r = await raiseAlert(
      await first(),
      {
        id: "event-1",
        workKey: "ATL-248",
        reason: "Release now follows the promised date.",
      },
      "forge:issue-change",
      REPLAY_NOW,
    );
    const again = await raiseAlert(
      r,
      { id: "event-1", workKey: "ATL-248", reason: "Duplicate" },
      "forge:issue-change",
      REPLAY_NOW,
    );
    expect(again).toBe(r);
    const reviewed = await apply(
      r,
      { action: "acknowledge", alertId: "event-1" },
      ACTOR.id,
      REPLAY_NOW,
    );
    expect(reviewed.data.alerts[0]!.acknowledgedBy).toBe(ACTOR.id);
    expect(await verify(reviewed)).toBe(true);
  });
  it("supports independent Node-only verification against a retained digest", async () => {
    const evidence = await bundle(await first(), initialWork, REPLAY_NOW);
    mkdirSync(".local", { recursive: true });
    const path = `.local/evidence-${crypto.randomUUID()}.json`;
    writeFileSync(path, JSON.stringify(evidence));
    try {
      const good = spawnSync(
        process.execPath,
        ["scripts/verify-bundle.mjs", path, evidence.bundleHash],
        { encoding: "utf8" },
      );
      expect(good.status).toBe(0);
      expect(JSON.parse(good.stdout).externalAnchorChecked).toBe(true);
      const bad = spawnSync(
        process.execPath,
        ["scripts/verify-bundle.mjs", path, "0".repeat(64)],
        { encoding: "utf8" },
      );
      expect(bad.status).toBe(1);
    } finally {
      unlinkSync(path);
    }
  });
});
