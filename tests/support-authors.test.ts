import { beforeEach, expect, it, vi } from "vitest";
const { request, settings } = vi.hoisted(() => ({
  request: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@forge/api", () => ({
  default: {
    asUser: () => ({ requestJira: request }),
    asApp: () => ({ requestJira: request }),
  },
  route: (s: TemplateStringsArray, ...v: unknown[]) =>
    s.reduce((a, b, n) => a + b + (v[n] ?? ""), ""),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get: settings } }));
import { readSource } from "../src/forge/jira";
let author: string;
let accountType: string;
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
beforeEach(() => {
  author = "approved-agent";
  accountType = "atlassian";
  settings.mockResolvedValue({
    supportAgents: { SUP: ["approved-agent"], OTHER: ["other-agent"] },
  });
  request.mockImplementation(async (path: string) => {
    if (path.includes("/servicedeskapi/"))
      return ok({
        id: "10",
        public: true,
        body: "We will deliver by 6 November 2026, tracked in ATL-1.",
        author: { accountId: author, displayName: author },
        created: { iso8601: "2026-11-02T09:00:00Z" },
      });
    if (path.includes("/user?")) return ok({ accountType });
    if (path.includes("/properties/")) return { ok: false, status: 404 };
    return ok({
      self: "https://site.atlassian.net/rest/api/3/issue/SUP-1/comment/10",
      updated: "2026-11-02T09:00:00Z",
    });
  });
});
it.each(["atlassian-customer", "unrelated-licensed-user", "other-agent"])(
  "rejects %s even though it is a regular Atlassian account",
  async (id) => {
    author = id;
    await expect(readSource("SUP-1", "10")).rejects.toThrow(
      "approved for this service project",
    );
  },
);
it("accepts the project-approved support author and rechecks settings on every read", async () => {
  expect((await readSource("SUP-1", "10")).source.author.id).toBe(author);
  settings.mockResolvedValue({ supportAgents: {} });
  await expect(readSource("SUP-1", "10")).rejects.toThrow("approved");
});
it("still rejects a portal-only customer even if mistakenly entered in the approved list", async () => {
  accountType = "customer";
  await expect(readSource("SUP-1", "10")).rejects.toThrow("Customer-authored");
});
