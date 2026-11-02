import { describe, expect, it } from "vitest";
import { promiseTitle } from "../src/core/capture";

describe("promise titles from a support reply", () => {
  it.each([
    [
      "We will deliver the workspace export by 6 November 2026, tracked in ATL-1.",
      "Workspace export",
    ],
    [
      "We will ship regional hosting in Atlas 2.8, tracked in ATL-2.",
      "Regional hosting",
    ],
    [
      "We will aim to make audit export available in Q1 2027, tracked in ATL-5.",
      "Audit export",
    ],
    [
      "Good news: we will deliver single sign-on for every workspace by 6 November 2026.",
      "Single sign-on",
    ],
  ])("%s", (reply, title) => expect(promiseTitle(reply)).toBe(title));
});
