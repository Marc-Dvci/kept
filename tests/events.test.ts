import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Work } from "../src/core/model";
import type { RecordState } from "../src/core/ledger";
const mock = vi.hoisted(() => ({
  readWork: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  readWorkSnapshot: vi.fn(),
  saveWorkSnapshot: vi.fn(),
  linkedIds: vi.fn(),
  query: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@forge/kvs", () => ({
  kvs: { query: mock.query, set: mock.set },
  WhereConditions: { beginsWith: (value: string) => value },
}));
vi.mock("../src/forge/store", () => mock);
vi.mock("../src/forge/jira", () => ({
  readWork: mock.readWork,
  readSource: vi.fn(),
  getSettings: vi.fn(),
}));
vi.mock("../src/forge/access", () => ({
  Inaccessible: class extends Error {},
}));
import {
  onIssueUpdated,
  sourceReferences,
  rememberSource,
} from "../src/forge/events";
import { seed, initialWork, REPLAY_NOW } from "../src/demo/data";
import { apply } from "../src/core/ledger";
let record: RecordState;
let work: Work;
let baseline: { version: number; data: Work };
beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(REPLAY_NOW));
  record = (await seed())[0]!;
  work = structuredClone(initialWork[0]!);
  baseline = { version: 1, data: structuredClone(work) };
  mock.linkedIds.mockResolvedValue([record.data.id]);
  mock.read.mockImplementation(async () => structuredClone(record));
  mock.readWork.mockImplementation(async () => structuredClone(work));
  mock.readWorkSnapshot.mockImplementation(async () =>
    structuredClone(baseline),
  );
  mock.save.mockImplementation(async (next: RecordState, expected: number) => {
    if (expected !== record.version || next.version !== expected + 1)
      throw new Error("Conflict");
    record = structuredClone(next);
  });
  mock.saveWorkSnapshot.mockImplementation(
    async (next: Work, expected: number) => {
      if (expected !== baseline.version) throw new Error("Conflict");
      baseline = { version: expected + 1, data: structuredClone(next) };
    },
  );
});
afterEach(() => vi.useRealTimers());
const refresh = () => onIssueUpdated({ issue: { key: work.key } });
describe("planning event contracts", () => {
  it("does not replace a newer Jira snapshot committed during alert processing", async () => {
    const initial = structuredClone(baseline);
    initial.data.updatedAt = "2026-11-02T09:00:00Z";
    work.updatedAt = "2026-11-02T09:30:00Z";
    Object.assign(work, { fetchedAt: REPLAY_NOW });
    work.versions[0]!.releaseOn = "2026-11-13";
    Object.assign(baseline.data, { fetchedAt: REPLAY_NOW });
    mock.readWorkSnapshot
      .mockResolvedValueOnce(initial)
      .mockImplementation(async () => structuredClone(baseline));
    await refresh();
    expect(mock.saveWorkSnapshot).not.toHaveBeenCalled();
  });
  it("pages discovery within its bound request instead of scanning the whole inbox", async () => {
    const query = {
      where: vi.fn(),
      limit: vi.fn(),
      cursor: vi.fn(),
      getMany: vi.fn(),
    };
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.cursor.mockReturnValue(query);
    query.getMany.mockResolvedValue({
      results: [{ value: { issueKey: "SUP-1", commentId: "100" } }],
      nextCursor: "next-page",
    });
    mock.query.mockReturnValue(query);
    const page = await sourceReferences("SUP-1", "previous-page");
    expect(page.cursor).toBe("next-page");
    expect(query.where).toHaveBeenCalledWith("key", "kept:source:SUP-1:");
    expect(query.limit).toHaveBeenCalledWith(20);
    expect(query.getMany).toHaveBeenCalledTimes(1);
    expect(query.cursor).toHaveBeenCalledWith("previous-page");
  });
  it("expires discovery references without assigning an expiry to promise evidence", async () => {
    await rememberSource("SUP-1", "100");
    expect(mock.set).toHaveBeenCalledWith(
      "kept:source:SUP-1:100",
      { issueKey: "SUP-1", commentId: "100", expiresAt: "2026-12-02T10:00:00.000Z" },
      { ttl: { value: 30, unit: "DAYS" } },
    );
  });
  it("retains a newly fetched plan when the attested blocked state has an older timestamp", async () => {
    Object.assign(baseline.data, { fetchedAt: REPLAY_NOW });
    Object.assign(work, { fetchedAt: REPLAY_NOW });
    work.observedAt = "2026-11-01T15:00:00Z";
    work.versions[0]!.releaseOn = "2026-11-13";
    await refresh();
    expect(record.data.alerts).toHaveLength(1);
  });
  it("retains successive sprint risks even when the Jira issue timestamp is unchanged", async () => {
    work.versions = [];
    work.sprint = {
      id: "s1",
      name: "Delivery",
      state: "active",
      endAt: "2026-11-05T17:00:00Z",
    };
    baseline.data = structuredClone(work);
    work.sprint.endAt = "2026-11-10T17:00:00Z";
    await refresh();
    work.sprint.endAt = "2026-11-12T17:00:00Z";
    await refresh();
    expect(record.data.alerts).toHaveLength(2);
    expect(record.data.alerts[0]!.id).not.toBe(record.data.alerts[1]!.id);
  });
  it("deduplicates repeat delivery but records a plan returning to a previously seen risk", async () => {
    work.versions[0]!.releaseOn = "2026-11-13";
    await refresh();
    await refresh();
    expect(record.data.alerts).toHaveLength(1);
    work.versions[0]!.releaseOn = "2026-11-06";
    await refresh();
    work.versions[0]!.releaseOn = "2026-11-13";
    await refresh();
    expect(record.data.alerts).toHaveLength(2);
  });
  it("does not alert a record relinked after the initial index lookup", async () => {
    const relinked = await apply(
      record,
      {
        action: "relink",
        workKeys: ["ATL-251"],
        owner: record.data.owner,
        reason: "The source was corrected to the regional hosting work.",
      },
      record.data.owner.id,
      REPLAY_NOW,
    );
    mock.read.mockResolvedValueOnce(record).mockResolvedValue(relinked);
    work.versions[0]!.releaseOn = "2026-11-13";
    await refresh();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("does not attempt an unchanged write when a record closes during event processing", async () => {
    const closed = await apply(
      record,
      {
        action: "cancel",
        agreementUrl: "https://example.com/agreement",
        reason: "The customer withdrew this request after review.",
      },
      record.data.owner.id,
      REPLAY_NOW,
    );
    mock.read.mockResolvedValueOnce(record).mockResolvedValue(closed);
    work.versions[0]!.releaseOn = "2026-11-13";
    await refresh();
    expect(mock.save).not.toHaveBeenCalled();
  });
});
