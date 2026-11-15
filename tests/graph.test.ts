import { describe, it, expect, vi } from "vitest";
vi.mock("@forge/teamwork-graph", () => ({ graph: {} }));
vi.mock("@forge/kvs", () => ({ kvs: {} }));
import { documents } from "../src/forge/graph";
import { seed, REPLAY_NOW } from "../src/demo/data";
describe("graph projection", () => {
  it("projects demo promise documents and sources without full reply or account IDs", async () => {
    const p = (await seed())[0]!.data;
    const projection = documents([p], REPLAY_NOW);
    expect(projection).toHaveLength(1);
    const text = JSON.stringify(projection);
    expect(text).toContain("Kept demo promise");
    expect(text).toContain(p.source.url);
    expect(text).not.toContain(p.confirmedBy);
    expect(text).not.toContain('"renewalOn"');
    expect(text).not.toContain('"body"');
  });
  it("keeps confirmed customer promises out of the workspace-wide graph", async () => {
    const p = (await seed())[0]!.data;
    p.synthetic = false;
    expect(() => documents([p], REPLAY_NOW)).toThrow("demo promises");
  });
});
