import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@forge/api", () => ({
  default: { asUser: () => ({ requestJira: request }) },
  route: (s: TemplateStringsArray, ...values: unknown[]) =>
    s.reduce((a, b, n) => a + b + (values[n] ?? ""), ""),
}));
import {
  actor,
  readable,
  editable,
  admin,
  bounded,
  Inaccessible,
  readScope,
} from "../src/forge/access";
beforeEach(() => request.mockReset());
describe("Atlassian access boundary", () => {
  it("checks a shared issue once within a request and checks it again in a new request", async () => {
    request.mockResolvedValue({ ok: true });
    const first = readScope({ accountId: "user" });
    await Promise.all(Array.from({ length: 100 }, () => first("ATL-1")));
    expect(request).toHaveBeenCalledTimes(1);
    await readScope({ accountId: "user" })("ATL-1");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("refuses missing context identity", () =>
    expect(() => actor({})).toThrow("Sign in"));
  it("ignores a payload-supplied identity", () =>
    expect(
      actor({ accountId: "actual", payload: { accountId: "forged" } }),
    ).toBe("actual"));
  it("omits inaccessible records without exposing them", async () =>
    expect(
      await bounded(["allowed", "hidden"], async (key) => {
        if (key === "hidden") throw new Inaccessible("Private");
        return key;
      }),
    ).toEqual(["allowed"]));
  it("does not interpret an outage as an empty population", async () => {
    request.mockResolvedValue({ ok: false, status: 503 });
    await expect(
      bounded(["ATL-1"], (key) => readable(key, { accountId: "user" })),
    ).rejects.toThrow("completely");
  });
  it("separately checks Edit Issues permission", async () => {
    request.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        permissions: { EDIT_ISSUES: { havePermission: false } },
      }),
    });
    await expect(editable("ATL-1", { accountId: "user" })).rejects.toThrow(
      "Edit Issues",
    );
  });
  it("requires global administration for settings", async () => {
    request.mockResolvedValue({
      ok: true,
      json: async () => ({ permissions: {} }),
    });
    await expect(admin({ accountId: "user" })).rejects.toThrow("administrator");
  });
  it("bounds API concurrency while preserving the accessible population", async () => {
    let active = 0;
    let peak = 0;
    const result = await bounded(
      Array.from({ length: 14 }, (_, n) => n),
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return n;
      },
    );
    expect(peak).toBeLessThanOrEqual(5);
    expect(result).toHaveLength(14);
  });
});
