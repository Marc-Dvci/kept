import { describe, it, expect, vi } from "vitest";
vi.mock("@forge/teamwork-graph", () => ({ graph: {} }));
vi.mock("@forge/kvs", () => ({ kvs: {} }));
import { documents } from "../src/forge/graph";
import { seed, REPLAY_NOW } from "../src/demo/data";
describe("graph projection", () => {
  it("projects synthetic documents and sources without full reply or account IDs", async () => {
    const p = (await seed())[0]!.data;
    const projection = documents([p], REPLAY_NOW);
    expect(projection).toHaveLength(1);
    const text = JSON.stringify(projection);
    expect(text).toContain("SYNTHETIC DEMONSTRATION");
    expect(text).toContain(p.source.url);
    expect(text).not.toContain(p.confirmedBy);
    expect(text).not.toContain('"renewalOn"');
    expect(text).not.toContain('"body"');
  });
  it("refuses to ingest real customer promises workspace-wide", async () => {
    const p = (await seed())[0]!.data;
    p.synthetic = false;
    expect(() => documents([p], REPLAY_NOW)).toThrow("synthetic");
  });
});
