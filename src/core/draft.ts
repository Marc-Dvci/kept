import { assess } from "./forecast";
import type { PromiseRecord, Work } from "./model";
export function customerDraft(
  p: PromiseRecord,
  works: Work[],
  now: string,
): string {
  const a = assess(p, works, now);
  return `Hi ${p.customer.name},\n\nAn update on “${p.title}”. Our recorded commitment is ${p.dueOn} (${p.timezone}). ${p.delivery ? `Customer availability was recorded at ${p.delivery.at}.` : a.forecastOn ? `The current linked delivery plan points to ${a.forecastOn}. This is the current plan, not a newly agreed commitment.` : "The linked work does not yet establish a reliable delivery date."}\n\n${a.state === "AT_RISK" || a.state === "BROKEN" ? "The commitment needs a reviewed follow-up. " : ""}${p.owner.name} owns that follow-up.\n\nSource: ${p.source.url}\nLinked work: ${p.workKeys.join(", ")}\n\nReview this draft against the source and delivery evidence before sending it through your approved customer channel.`;
}
