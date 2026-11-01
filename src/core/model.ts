import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";

export const instant = z.iso.datetime({ offset: true });
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    try {
      Temporal.PlainDate.from(s);
      return true;
    } catch {
      return false;
    }
  }, "Use a real ISO calendar date");
export const timezone = z.string().refine((s) => {
  try {
    Temporal.Now.zonedDateTimeISO(s);
    return true;
  } catch {
    return false;
  }
}, "Use an IANA timezone");
export const issueKey = z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/);
export const httpUrl = z
  .string()
  .url()
  .refine((s) => /^https?:\/\//.test(s));
export const personSchema = z.object({
  id: z.string().min(1).max(150),
  name: z.string().min(1).max(100),
});
export const customerSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  renewalOn: date.nullable(),
});
export const sourceSchema = z.object({
  id: z.string().min(1).max(150),
  issueKey,
  body: z.string().min(1).max(12000),
  public: z.literal(true),
  author: personSchema,
  createdAt: instant,
  updatedAt: instant,
  url: httpUrl,
});
export const versionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  releaseOn: date.nullable(),
  released: z.boolean(),
  archived: z.boolean(),
});
export const workSchema = z.object({
  key: issueKey,
  title: z.string().min(1).max(250),
  url: httpUrl,
  status: z.enum(["todo", "in-progress", "done"]),
  cancelled: z.boolean(),
  blocked: z.boolean().nullable(),
  versions: z.array(versionSchema).max(30),
  sprint: z
    .object({
      id: z.string(),
      name: z.string(),
      endAt: instant.nullable(),
      state: z.enum(["active", "future", "closed"]),
    })
    .nullable(),
  observedAt: instant,
  fetchedAt: instant.optional(),
  updatedAt: instant,
});
export const deliverySchema = z.object({
  at: instant,
  url: httpUrl,
  note: z.string().trim().min(12).max(1000),
  actor: z.string().min(1),
  recordedAt: instant,
});
export const alertSchema = z.object({
  id: z.string(),
  at: instant,
  workKey: issueKey,
  reason: z.string(),
  acknowledgedAt: instant.nullable(),
  acknowledgedBy: z.string().nullable(),
});
export const promiseSchema = z
  .object({
    id: z.string().regex(/^KPT-[a-zA-Z0-9-]+$/),
    title: z.string().trim().min(4).max(200),
    customer: customerSchema,
    owner: personSchema,
    source: sourceSchema,
    excerpt: z.string().min(1).max(2000),
    workKeys: z.array(issueKey).min(1).max(20),
    originalDueOn: date,
    dueOn: date,
    timezone,
    confirmedAt: instant,
    confirmedBy: z.string().min(1),
    synthetic: z.boolean(),
    delivery: deliverySchema.nullable(),
    cancellation: z
      .object({
        at: instant,
        actor: z.string().min(1),
        agreementUrl: httpUrl,
        reason: z.string().trim().min(12).max(1000),
      })
      .nullable(),
    amendments: z
      .array(
        z.object({
          from: date,
          to: date,
          at: instant,
          actor: z.string().min(1),
          agreementUrl: httpUrl,
          reason: z.string().trim().min(12).max(1000),
        }),
      )
      .max(50),
    alerts: z.array(alertSchema).max(100),
  })
  .superRefine((p, ctx) => {
    if (!p.source.body.includes(p.excerpt))
      ctx.addIssue({
        code: "custom",
        message: "The excerpt must occur exactly in the source reply",
      });
    if (new Set(p.workKeys).size !== p.workKeys.length)
      ctx.addIssue({
        code: "custom",
        message: "Link each work item only once",
      });
    if (p.delivery && p.cancellation)
      ctx.addIssue({
        code: "custom",
        message: "A delivered promise cannot also be cancelled",
      });
    if (Date.parse(p.confirmedAt) < Date.parse(p.source.createdAt))
      ctx.addIssue({
        code: "custom",
        message: "Confirmation cannot precede the source reply",
      });
  });
export type Source = z.infer<typeof sourceSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type Person = z.infer<typeof personSchema>;
export type Work = z.infer<typeof workSchema>;
export type Release = z.infer<typeof versionSchema>;
export type PromiseRecord = z.infer<typeof promiseSchema>;
export const STATES = [
  "ON_TRACK",
  "AT_RISK",
  "BROKEN",
  "KEPT",
  "UNKNOWN",
  "CANCELLED",
] as const;
export type State = (typeof STATES)[number];
export type Assessment = {
  state: State;
  reasons: string[];
  deadlineAt: string;
  forecastOn: string | null;
  originalState: State;
  originalDueOn: string;
  ruleVersion: string;
};
export const RULE_VERSION = "2026-11-01.1";
export const MAX_AGE_HOURS = 24;

export function endOfDay(on: string, zone: string): string {
  date.parse(on);
  timezone.parse(zone);
  return Temporal.PlainDate.from(on)
    .add({ days: 1 })
    .toZonedDateTime(zone)
    .toInstant()
    .subtract({ milliseconds: 1 })
    .toString();
}
export function localDay(at: string, zone: string): string {
  return Temporal.Instant.from(at)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
