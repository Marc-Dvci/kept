import { assess } from "./forecast";
import type { PromiseRecord, Work } from "./model";
export function customerDraft(
  p: PromiseRecord,
  works: Work[],
  now: string,
): string {
  const a = assess(p, works, now);
  const status = p.cancellation
    ? "This request has been withdrawn by recorded agreement."
    : p.delivery
      ? `Customer availability was recorded at ${p.delivery.at}.${a.state === "BROKEN" ? " This was after the agreed date." : ""}`
      : a.state === "BROKEN"
        ? "The agreed date has passed without recorded customer availability. We need to review the outstanding delivery with you."
        : a.state === "UNKNOWN"
          ? "The delivery evidence is incomplete. We are reviewing it before confirming a current delivery date."
          : `${a.forecastOn ? `The current linked delivery plan points to ${a.forecastOn}. ` : ""}${a.state === "AT_RISK" ? "The current work puts this commitment at risk. " : ""}Your agreed date remains unchanged unless we agree a revision with you.`;
  return `Hi ${p.customer.name},\n\nAn update on “${p.title}”. Our recorded commitment is ${p.dueOn} (${p.timezone}). ${status}\n\n${p.owner.name} is your follow-up owner.`;
}
