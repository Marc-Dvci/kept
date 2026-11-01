import { describe, it, expect } from "vitest";
import { customerDraft } from "../src/core/draft";
import { makeRecord } from "../src/demo/fixtures";
describe("reviewable customer wording", () => {
  it("does not imply a complete delivery date from partial evidence", () => {
    const f = makeRecord({ extraMissingWork: true });
    const draft = customerDraft(f.promise, f.works, f.now);
    expect(draft).toContain("incomplete");
    expect(draft).not.toContain("plan points to");
  });
  it("describes an agreed withdrawal", () => {
    const f = makeRecord({ cancelled: true });
    expect(customerDraft(f.promise, f.works, f.now)).toContain("withdrawn");
  });
  it("keeps internal references and review instructions out of the copied message", () => {
    const f = makeRecord();
    const draft = customerDraft(f.promise, f.works, f.now);
    expect(draft).not.toContain(f.promise.source.url);
    expect(draft).not.toContain("Review this draft");
    expect(draft).not.toContain("Linked work:");
  });
});
