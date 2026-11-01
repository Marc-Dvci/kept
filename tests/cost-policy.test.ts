import { describe, expect, it } from "vitest";
import { requireProtection } from "../src/core/cost-policy";
import policy from "../config/billing-protection.json";
describe("zero-spend release gate", () => {
  it("blocks the shipped policy before a CLI invocation", () =>
    expect(() => requireProtection(policy, "2026-11-01T10:00:00Z")).toThrow(
      "blocked",
    ));
  it("refuses expired provider evidence", () =>
    expect(() =>
      requireProtection(
        {
          kind: "billing-exempt-sandbox",
          evidenceUrl: "https://example.com/provider-proof",
          verifiedAt: "2026-10-01T00:00:00Z",
          expiresAt: "2026-10-31T00:00:00Z",
        },
        "2026-11-01T10:00:00Z",
      ),
    ).toThrow("current provider"));
  it("refuses an unsupported free-allowance claim", () =>
    expect(() =>
      requireProtection({ kind: "free-allowance" }, "2026-11-01T10:00:00Z"),
    ).toThrow());
  it("refuses a future-dated verification", () =>
    expect(() =>
      requireProtection(
        {
          kind: "atlassian-hard-cap",
          evidenceUrl: "https://example.com/provider-proof",
          verifiedAt: "2026-12-01T00:00:00Z",
          expiresAt: "2026-12-31T00:00:00Z",
        },
        "2026-11-01T10:00:00Z",
      ),
    ).toThrow("current provider"));
});
