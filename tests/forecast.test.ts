import { describe, it, expect } from "vitest";
import cases from "../eval/cases.json";
import secondary from "../eval/secondary.json";
import { makeRecord } from "../src/demo/fixtures";
import { assess, preview } from "../src/core/forecast";
import { endOfDay } from "../src/core/model";
import { seed, initialWork, REPLAY_NOW } from "../src/demo/data";
describe("frozen forecast cases", () => {
  it.each([...cases, ...secondary])("$id", (c) => {
    const f = makeRecord(c.patch);
    expect(assess(f.promise, f.works, f.now).state).toBe(c.expected);
  });
});
describe("customer impact and calendar boundaries", () => {
  it("keeps renewal totals uncertain when one customer ID has conflicting organisation names", async () => {
    const records = (await seed()).slice(0, 2);
    records[1]!.data.customer = {
      ...records[0]!.data.customer,
      name: "A different organisation",
    };
    const result = preview(
      records.map((r) => r.data),
      initialWork,
      { workKey: "ATL-248", blocked: true },
      REPLAY_NOW,
    );
    expect(result.conflictingCustomers).toBe(1);
    expect(result.renewals).toBe(0);
    expect(result.unknownRenewals).toBe(1);
  });
  it("counts a risk established from previously incomplete evidence", () => {
    const f = makeRecord({ blocked: null });
    const result = preview(
      [f.promise],
      f.works,
      { workKey: "ATL-1", blocked: true },
      f.now,
    );
    expect(result.rows[0]!.before.state).toBe("UNKNOWN");
    expect(result.rows[0]!.after.state).toBe("AT_RISK");
    expect(result.newlyAtRisk).toBe(1);
  });
  it("treats conflicting renewal dates as unknown regardless of record order", async () => {
    const records = (await seed()).slice(0, 2);
    records[1]!.data.customer = {
      ...records[0]!.data.customer,
      renewalOn: "2027-06-01",
    };
    for (const input of [records, [...records].reverse()]) {
      const result = preview(
        input.map((r) => r.data),
        initialWork,
        { workKey: "ATL-248", blocked: true },
        REPLAY_NOW,
      );
      expect(result.customers).toBe(1);
      expect(result.renewals).toBe(0);
      expect(result.unknownRenewals).toBe(1);
    }
  });
  it("keeps an original missed obligation visible after a later withdrawal", () => {
    const f = makeRecord({ dueOn: "2026-10-31", cancelled: true });
    const result = assess(f.promise, f.works, f.now);
    expect(result.state).toBe("CANCELLED");
    expect(result.originalState).toBe("BROKEN");
  });
  it("does not refresh stale blocked evidence when only a proposed release date changes", () => {
    const f = makeRecord({ observedAt: "2026-10-29T09:00:00Z" });
    const result = preview(
      [f.promise],
      f.works,
      { workKey: "ATL-1", releaseOn: "2026-11-05" },
      f.now,
    );
    expect(result.rows[0]!.after.state).toBe("UNKNOWN");
  });
  it("includes every item sharing the changed release and counts stable customer IDs", async () => {
    const records = await seed();
    const before = JSON.stringify([records, initialWork]);
    const result = preview(
      records.map((r) => r.data),
      initialWork,
      { workKey: "ATL-248", releaseOn: "2026-11-13" },
      REPLAY_NOW,
    );
    expect(result.affected).toBe(4);
    expect(result.newlyAtRisk).toBe(3);
    expect(result.customers).toBe(4);
    expect(result.renewals).toBe(3);
    expect(JSON.stringify([records, initialWork])).toBe(before);
  });
  it("does not multiply a customer when two promises share its stable ID", async () => {
    const records = await seed();
    records[1]!.data.customer = records[0]!.data.customer;
    const result = preview(
      records.map((r) => r.data),
      initialWork,
      { workKey: "ATL-248", blocked: true },
      REPLAY_NOW,
    );
    expect(result.affected).toBe(2);
    expect(result.customers).toBe(1);
    expect(result.renewals).toBe(1);
  });
  it("ignores archived versions as planning bounds", () => {
    const f = makeRecord();
    f.works[0]!.versions.push({
      id: "old",
      name: "Archived",
      releaseOn: "2026-12-31",
      released: false,
      archived: true,
    });
    expect(assess(f.promise, f.works, f.now).state).toBe("ON_TRACK");
  });
  it("preserves the original outcome after an agreed later date", () => {
    const f = makeRecord({ dueOn: "2026-10-31" });
    f.promise.dueOn = "2026-11-06";
    const a = assess(f.promise, f.works, f.now);
    expect(a.state).toBe("ON_TRACK");
    expect(a.originalState).toBe("BROKEN");
  });
  it("uses the end of the local day through daylight-saving transitions", () => {
    expect(endOfDay("2026-10-25", "Europe/Paris")).toBe(
      "2026-10-25T22:59:59.999Z",
    );
    expect(endOfDay("2026-11-01", "America/New_York")).toBe(
      "2026-11-02T04:59:59.999Z",
    );
  });
  it("does not call a zero-length required work set healthy", () => {
    const f = makeRecord();
    f.promise.workKeys = [];
    expect(() => assess(f.promise, [], f.now)).toThrow();
  });
});
