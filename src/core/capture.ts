import { Temporal } from "@js-temporal/polyfill";
import { sourceSchema, localDay, type Source, type Release } from "./model";
export type Candidate = {
  id: string;
  excerpt: string;
  dueOn: string | null;
  precision: "day" | "quarter" | "release";
  review: string[];
  workKeys: string[];
};
const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const valid = (s: string): string | null => {
  try {
    return Temporal.PlainDate.from(s).toString();
  } catch {
    return null;
  }
};
const padded = (year: number, month: number, day: number) =>
  valid(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** English proposals only. Every returned item requires explicit human confirmation. */
export function propose(
  input: unknown,
  releases: Release[],
  zone: string,
): Candidate[] {
  const parsed = sourceSchema.safeParse(input);
  if (!parsed.success) return [];
  const source: Source = parsed.data;
  const today = Temporal.PlainDate.from(localDay(source.createdAt, zone));
  const candidates: Candidate[] = [];
  for (const line of source.body.split(/\n/)) {
    if (/^\s*>/.test(line)) continue;
    for (const excerpt of line
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (
        excerpt.endsWith("?") ||
        /\b(?:cannot|can['’]t|won['’]t|will not|not able|do not|don['’]t|no (?:firm )?date)\b/i.test(
          excerpt,
        )
      )
        continue;
      if (
        !/\b(?:we (?:will|can|promise|commit)|we['’]ll|will (?:be|ship|deliver|release|roll)|you(?:['’]ll| will)|(?:ship|deliver|ready|available|fix|release) by|scheduled for)\b/i.test(
          excerpt,
        )
      )
        continue;
      const dates: string[] = [];
      const review: string[] = [];
      const rawDates = [...excerpt.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(
        (m) => m[1]!,
      );
      for (const on of rawDates) {
        const d = valid(on);
        if (d) dates.push(d);
        else review.push(`Invalid calendar date ${on}.`);
      }
      for (const m of excerpt.matchAll(
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b(?:\s+(20\d{2}))?/gi,
      )) {
        const d = padded(
          Number(m[3] ?? today.year),
          months.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1,
          Number(m[1]),
        );
        if (d) dates.push(d);
        else review.push("Invalid written calendar date.");
        if (!m[3])
          review.push(`Year inferred from the source reply: ${today.year}.`);
      }
      for (const m of excerpt.matchAll(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(20\d{2}))?/gi,
      )) {
        const d = padded(
          Number(m[3] ?? today.year),
          months.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1,
          Number(m[2]),
        );
        if (d) dates.push(d);
        else review.push("Invalid written calendar date.");
        if (!m[3])
          review.push(`Year inferred from the source reply: ${today.year}.`);
      }
      let precision: Candidate["precision"] = "day";
      if (!dates.length && /\btomorrow\b/i.test(excerpt))
        dates.push(today.add({ days: 1 }).toString());
      if (!dates.length) {
        const weekday = excerpt.match(
          /\b(by|on|next)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
        );
        if (weekday) {
          if (weekday[1]!.toLowerCase() === "next")
            review.push(
              "‘Next’ weekday is ambiguous; choose the agreed calendar date.",
            );
          else {
            const delta =
              (weekdays.indexOf(weekday[2]!.toLowerCase()) +
                1 -
                today.dayOfWeek +
                7) %
              7;
            dates.push(today.add({ days: delta }).toString());
            review.push(
              "Weekday resolved from the source date in the selected timezone; verify the intended week.",
            );
          }
        }
      }
      const matchedVersions = releases.filter(
        (v) =>
          !v.archived &&
          new RegExp(`(?:^|\\W)${escape(v.name)}(?:$|\\W)`, "i").test(excerpt),
      );
      if (!dates.length && matchedVersions.length) {
        precision = "release";
        for (const v of matchedVersions)
          if (v.releaseOn) dates.push(v.releaseOn);
          else review.push(`${v.name} has no release date.`);
        review.push(
          "Release names refer to mutable plans; confirm the customer-agreed date.",
        );
      }
      if (!dates.length && /\bQ[1-4]\s*(?:20\d{2})?\b/i.test(excerpt)) {
        precision = "quarter";
        review.push(
          "A quarter is a delivery window, not an exact date. Choose the agreed end date explicitly.",
        );
      }
      if (!dates.length && !review.length) continue;
      const unique = [...new Set(dates)];
      if (unique.length > 1)
        review.push(
          "Several different dates occur in the same sentence; select the agreed promise date.",
        );
      if (
        /\b(?:hope|aim|target|tentative|possibly|maybe|expect)\b/i.test(excerpt)
      )
        review.push(
          "Tentative wording: this may be a target rather than a commitment.",
        );
      let dueOn =
        unique.length === 1 &&
        !review.some((r) => /Invalid|ambiguous|no release date/.test(r))
          ? unique[0]!
          : null;
      if (
        source.updatedAt !== source.createdAt &&
        (/\b(?:tomorrow|next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:by|on)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i.test(
          excerpt,
        ) ||
          review.some((r) => r.startsWith("Year inferred")))
      ) {
        dueOn = null;
        review.push(
          "Edited reply: verify the intended relative date and year explicitly.",
        );
      }
      if (dueOn && dueOn < today.toString())
        review.push(
          "This proposed date precedes the reply; verify the year and original obligation.",
        );
      candidates.push({
        id: `${source.id}:${candidates.length}`,
        excerpt,
        dueOn,
        precision,
        review,
        workKeys: [...new Set(excerpt.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) ?? [])],
      });
    }
  }
  return candidates;
}
