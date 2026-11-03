import { beforeEach, describe, expect, it, vi } from "vitest";
const { request, setting } = vi.hoisted(() => ({
  request: vi.fn(),
  setting: vi.fn(),
}));
vi.mock("@forge/api", () => ({
  default: {
    asUser: () => ({ requestJira: request }),
    asApp: () => ({ requestJira: request }),
  },
  route: (s: TemplateStringsArray, ...values: unknown[]) =>
    s.reduce((a, b, n) => a + b + (values[n] ?? ""), ""),
}));
vi.mock("@forge/kvs", () => ({ kvs: { get: setting } }));
import { readWork, readSource } from "../src/forge/jira";
const now = "2026-11-02T10:00:00Z";
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
beforeEach(() => {
  request.mockReset();
  setting.mockReset();
  setting.mockResolvedValue({
    sprintField: "",
    flagField: "",
    captureProjects: [],
  });
});
const issue = () => ({
  self: "https://test.atlassian.net/rest/api/3/issue/101",
  fields: {
    summary: "Customer export",
    status: { statusCategory: { key: "indeterminate" } },
    resolution: null,
    fixVersions: [
      {
        id: "v1",
        name: "Atlas 2.8",
        releaseDate: "2026-11-06",
        released: false,
        archived: false,
      },
    ],
    updated: now,
  },
});
describe("canonical Jira sources", () => {
  it("reads Jira's documented versioned sprint representation", async () => {
    setting.mockResolvedValue({
      sprintField: "customfield_10020",
      flagField: "customfield_10021",
    });
    const b = {
      ...issue(),
      fields: {
        ...issue().fields,
        customfield_10021: [],
        customfield_10020: ["legacy Sprint@1[state=ACTIVE]"],
      },
      versionedRepresentations: {
        customfield_10020: {
          "2": [
            {
              id: 7,
              name: "Delivery",
              state: "active",
              endDate: "2026-11-12T17:00:00Z",
            },
          ],
        },
      },
    };
    request.mockResolvedValueOnce(ok(b));
    expect((await readWork("ATL-1", now)).sprint?.endAt).toBe(
      "2026-11-12T17:00:00.000Z",
    );
    expect(request.mock.calls[0]![0]).toContain(
      "expand=versionedRepresentations",
    );
  });
  it("reads the live response, which carries only versionedRepresentations", async () => {
    // Shape returned by Jira Cloud for ?fields=...&expand=versionedRepresentations (captured 2 Nov 2026).
    setting.mockResolvedValue({
      sprintField: "customfield_10020",
      flagField: "customfield_10021",
      captureProjects: [],
    });
    request.mockResolvedValueOnce(
      ok({
        self: "https://test.atlassian.net/rest/api/3/issue/10163",
        key: "ATL-1",
        versionedRepresentations: {
          summary: { "1": "Export every workspace, in one file" },
          customfield_10020: { "1": null, "2": [] },
          customfield_10021: { "1": [{ value: "Impediment" }] },
          fixVersions: {
            "1": [
              {
                id: "10000",
                name: "Atlas 2.8",
                archived: false,
                released: false,
                releaseDate: "2026-11-06",
              },
            ],
          },
          status: { "1": { statusCategory: { key: "new" } } },
          resolution: { "1": null },
          updated: { "1": now },
        },
      }),
    );
    const work = await readWork("ATL-1", now);
    expect(work.title).toBe("Export every workspace, in one file");
    expect(work.status).toBe("todo");
    expect(work.blocked).toBe(true);
    expect(work.versions[0]!.releaseOn).toBe("2026-11-06");
    expect(work.sprint).toBeNull();
  });
  it("treats an explicitly returned empty checkbox as unflagged", async () => {
    setting.mockResolvedValue({ flagField: "customfield_10021" });
    request
      .mockResolvedValueOnce(
        ok({
          ...issue(),
          fields: { ...issue().fields, customfield_10021: null },
        }),
      )
      .mockResolvedValueOnce({ ok: false, status: 404 });
    expect((await readWork("ATL-1", now)).blocked).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("stops on an unsupported sprint representation rather than omitting its bound", async () => {
    setting.mockResolvedValue({
      sprintField: "customfield_10020",
      flagField: "customfield_10021",
    });
    request.mockResolvedValueOnce(
      ok({
        ...issue(),
        fields: {
          ...issue().fields,
          customfield_10021: [],
          customfield_10020: ["legacy sprint"],
        },
      }),
    );
    await expect(readWork("ATL-1", now)).rejects.toThrow("sprint");
  });
  it("retains the actual age of a still-valid blocked-state attestation", async () => {
    request
      .mockResolvedValueOnce(ok(issue()))
      .mockResolvedValueOnce(
        ok({ value: { blocked: false, observedAt: "2026-11-01T15:00:00Z" } }),
      );
    expect((await readWork("ATL-1", now)).observedAt).toBe(
      "2026-11-01T15:00:00.000Z",
    );
  });
  it("keeps blocked state unknown when no configured field or fresh attestation exists", async () => {
    request
      .mockResolvedValueOnce(ok(issue()))
      .mockResolvedValueOnce({ ok: false, status: 404 });
    expect((await readWork("ATL-1", now)).blocked).toBeNull();
  });
  it("uses the explicitly configured flag field", async () => {
    setting.mockResolvedValue({
      sprintField: "",
      flagField: "customfield_10021",
      captureProjects: [],
    });
    const b = issue();
    Object.assign(b.fields, { customfield_10021: [] });
    request.mockResolvedValueOnce(ok(b));
    expect((await readWork("ATL-1", now)).blocked).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not redate a stale blocked-state attestation", async () => {
    request
      .mockResolvedValueOnce(ok(issue()))
      .mockResolvedValueOnce(
        ok({ value: { blocked: false, observedAt: "2026-10-29T10:00:00Z" } }),
      );
    expect((await readWork("ATL-1", now)).blocked).toBeNull();
  });
  it("stops on an unavailable planning property rather than guessing unblocked", async () => {
    request
      .mockResolvedValueOnce(ok(issue()))
      .mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(readWork("ATL-1", now)).rejects.toThrow("completely");
  });
  it("rejects an internal support reply before retaining its body", async () => {
    request.mockResolvedValueOnce(
      ok({ id: "100", public: false, body: "Internal instructions" }),
    );
    await expect(readSource("SUP-1", "100")).rejects.toThrow("public");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects the customer's own comment as an outgoing commitment", async () => {
    request
      .mockResolvedValueOnce(
        ok({
          id: "100",
          public: true,
          body: "We will deliver by Friday.",
          author: { accountId: "customer" },
        }),
      )
      .mockResolvedValueOnce(ok({ accountType: "customer" }));
    await expect(readSource("SUP-1", "100")).rejects.toThrow(
      "Customer-authored",
    );
  });
  it("retains current metadata so an edited source has a distinct fingerprint", async () => {
    setting.mockResolvedValue({ supportAgents: { SUP: ["agent"] } });
    request
      .mockResolvedValueOnce(
        ok({
          id: "100",
          public: true,
          body: "We will deliver by Friday, tracked in ATL-1.",
          author: { accountId: "agent", displayName: "Support agent" },
          createdDate: { iso8601: "2026-11-01T10:00:00Z" },
        }),
      )
      .mockResolvedValueOnce(ok({ accountType: "atlassian" }))
      .mockResolvedValueOnce(
        ok({
          self: "https://test.atlassian.net/rest/api/3/issue/SUP-1/comment/100",
          created: "2026-11-01T10:00:00Z",
          updated: now,
        }),
      )
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const item = await readSource("SUP-1", "100");
    expect(item.source.updatedAt).toBe(now.replace("Z", ".000Z"));
    expect(item.source.body).toContain("ATL-1");
    expect(item.suggestedKey).toBe("ATL-1");
    expect(item.customer.name).toContain("Choose");
  });
});
