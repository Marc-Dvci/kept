import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  records: new Map<string, any>(),
  deleted: [] as string[],
  request: vi.fn(),
}));
vi.mock("@forge/api", () => ({
  default: { asUser: () => ({ requestJira: mock.request }) },
  route: (s: TemplateStringsArray, ...v: unknown[]) =>
    s.reduce((a, b, n) => a + b + (v[n] ?? ""), ""),
}));
vi.mock("@forge/kvs", () => ({
  WhereConditions: { beginsWith: (prefix: string) => prefix },
  kvs: {
    delete: async (key: string) => {
      mock.values.delete(key);
    },
    entity: (name: string) => ({
      delete: async (key: string) => {
        mock.deleted.push(`${name}:${key}`);
        if (name === "promise") mock.records.delete(key);
      },
    }),
    query: () => {
      let prefix = "";
      const q = {
        where: (_: string, p: string) => {
          prefix = p;
          return q;
        },
        limit: () => q,
        getMany: async () => ({
          results: [...mock.values]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({ key, value })),
        }),
      };
      return q;
    },
  },
}));
vi.mock("../src/forge/store", () => ({
  keys: async () => [...mock.records.keys()],
  read: async (id: string) => mock.records.get(id),
}));
import { resetDemo } from "../src/forge/demo";
beforeEach(() => {
  mock.values.clear();
  mock.records.clear();
  mock.deleted.length = 0;
  mock.request.mockReset();
  mock.request.mockResolvedValue({ ok: true, status: 204 });
  mock.records.set("KPT-confirmed", {
    data: {
      synthetic: false,
      source: { issueKey: "SUP-1" },
      workKeys: ["ATL-1"],
    },
  });
  mock.records.set("KPT-ATL-001", {
    data: {
      synthetic: true,
      source: { issueKey: "SUP-2" },
      workKeys: ["ATL-2"],
    },
  });
  for (const [marker, key] of [
    ["101", "SUP-1"],
    ["001", "SUP-2"],
  ]) {
    mock.values.set(`kept:demo-source:ATL:${marker}`, key);
    mock.values.set(`kept:demo-reply:ATL:${marker}`, "10");
    mock.values.set(`kept:demo-inbox:ATL:${marker}`, true);
    mock.values.set(`kept:source:${key}:10`, {});
  }
  mock.values.set("kept:source:REAL-99:5", {});
  mock.values.set("kept:demo-work:ATL:ATL-248", "ATL-1");
  mock.values.set("kept:demo-work-ready:ATL:ATL-248", true);
  mock.values.set("kept:demo-work:ATL:ATL-251", "ATL-2");
  mock.values.set("kept:demo-work-ready:ATL:ATL-251", true);
  mock.values.set("kept:demo-plan-restored:ATL", true);
});
it("preserves confirmed sources, real discovery and their delivery plans while deleting unused demo data", async () => {
  expect(await resetDemo()).toEqual({ removed: 1, preserved: 1 });
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(mock.request).toHaveBeenCalledWith("/rest/api/3/issue/SUP-2", {
    method: "DELETE",
  });
  expect(mock.values.has("kept:demo-source:ATL:101")).toBe(true);
  expect(mock.values.has("kept:demo-source:ATL:001")).toBe(false);
  expect(mock.values.has("kept:source:REAL-99:5")).toBe(true);
  expect(mock.values.has("kept:source:SUP-1:10")).toBe(true);
  expect(mock.values.has("kept:source:SUP-2:10")).toBe(false);
  expect(mock.values.has("kept:demo-work-ready:ATL:ATL-248")).toBe(true);
  expect(mock.values.has("kept:demo-plan-restored:ATL")).toBe(true);
  expect(mock.deleted).toEqual(["promise:KPT-ATL-001", "work:ATL-2"]);
  expect((await resetDemo()).removed).toBe(0);
});
it("retains retry and discovery markers when Jira refuses deletion", async () => {
  mock.request.mockResolvedValue({ ok: false, status: 403 });
  await expect(resetDemo()).rejects.toThrow("retry markers have been retained");
  expect(mock.values.has("kept:demo-source:ATL:001")).toBe(true);
  expect(mock.values.has("kept:demo-reply:ATL:001")).toBe(true);
  expect(mock.values.has("kept:source:SUP-2:10")).toBe(true);
  mock.request.mockResolvedValue({ ok: false, status: 404 });
  await resetDemo();
  expect(mock.values.has("kept:demo-source:ATL:001")).toBe(false);
});
