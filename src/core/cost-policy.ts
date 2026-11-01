import { z } from "zod";
export const protectionSchema = z.object({
  kind: z.enum(["unverified", "billing-exempt-sandbox", "atlassian-hard-cap"]),
  evidenceUrl: z.string().url().optional(),
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export function requireProtection(input: unknown, now: string) {
  const policy = protectionSchema.parse(input);
  if (policy.kind === "unverified")
    throw new Error(
      "Forge registration and deployment are blocked: provider-backed zero-billing protection is unverified. Use the free replay.",
    );
  if (
    !policy.evidenceUrl?.startsWith("https://") ||
    !policy.verifiedAt ||
    !policy.expiresAt ||
    !Number.isFinite(Date.parse(now)) ||
    Date.parse(policy.verifiedAt) > Date.parse(now) ||
    Date.parse(policy.expiresAt) <= Date.parse(now)
  )
    throw new Error(
      "A current provider protection record and verification period are required",
    );
}
