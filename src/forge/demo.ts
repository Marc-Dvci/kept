import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { Temporal } from "@js-temporal/polyfill";
import { releases, initialWork, customers } from "../demo/data";
import {
  localDay,
  type Customer,
  type Person,
  type Source,
} from "../core/model";
import { confirm, apply } from "../core/ledger";
import { save, read, readWorkSnapshot, saveWorkSnapshot } from "./store";
import { readWork, readSource, getSettings, settingsSchema } from "./jira";
import { rememberSource } from "./events";

type Json = Record<string, any>;
async function call(path: ReturnType<typeof route>, init?: RequestInit) {
  const response = await api.asUser().requestJira(path, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
  } as never);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Demo setup stopped at a Jira call (HTTP ${response.status}). It is safe to retry. ${text.slice(0, 160)}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as Json;
}
async function once<T>(marker: string, make: () => Promise<T>): Promise<T> {
  const old = await kvs.get<T>(marker);
  if (old !== undefined && old !== null) return old;
  const value = await make();
  await kvs.set(marker, value as never);
  return value;
}
const doc = (text: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const written = (on: string) => {
  const d = Temporal.PlainDate.from(on);
  return `${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
};

// What each customer asked, and the support reply that made the promise.
const asks: Record<string, { summary: string; body: string; reply: string }> = {
  "Workspace export": {
    summary: "We need a full export of our workspaces",
    body: "Our auditors ask for a complete export of every workspace before the renewal. When can we have it?",
    reply:
      "Thanks for your patience. We will deliver the workspace export by {date}, tracked in {key}. I will confirm here the day it is available.",
  },
  "Regional hosting": {
    summary: "Data residency for our EU workspaces",
    body: "Legal needs our data hosted in the EU region. Is regional hosting on your plan?",
    reply:
      "Good news: we will deliver regional hosting by {date}, tracked in {key}. I will keep you posted here.",
  },
  "Single sign-on": {
    summary: "SSO for every workspace",
    body: "Our security team requires single sign-on on all workspaces before we expand the contract.",
    reply:
      "We will deliver single sign-on for every workspace by {date}, tracked in {key}.",
  },
  "Invoice history": {
    summary: "Invoice history in the customer portal",
    body: "Finance wants to download past invoices from the portal instead of emailing support.",
    reply:
      "We will deliver invoice history in the portal by {date}, tracked in {key}.",
  },
  "Workspace audit export": {
    summary: "Audit log export",
    body: "Can we export the workspace audit log for our annual review?",
    reply:
      "We will deliver the workspace audit export by {date}, tracked in {key}.",
  },
};
const promises = [
  ["001", "Workspace export", 0, "ATL-248", "2026-11-06"],
  ["002", "Workspace export", 1, "ATL-248", "2026-11-06"],
  ["003", "Regional hosting", 2, "ATL-251", "2026-11-09"],
  ["004", "Single sign-on", 3, "ATL-260", "2026-11-06"],
  ["005", "Invoice history", 4, "ATL-237", "2026-10-30"],
  ["006", "Workspace audit export", 5, "ATL-265", "2026-11-16"],
  ["007", "Invoice history", 0, "ATL-237", "2026-10-30"],
  ["008", "Regional hosting", 3, "ATL-251", "2026-11-13"],
] as const;
// Replies left unconfirmed, so the capture inbox has work to review.
const incoming = [
  {
    id: "101",
    customer: 5,
    work: "ATL-248",
    summary: "Export before our board meeting",
    body: "We present to our board next week. Will the workspace export be ready?",
    reply:
      "We will deliver the workspace export by {date248}, tracked in {ATL-248}. I will follow up as soon as it is available.",
  },
  {
    id: "102",
    customer: 4,
    work: "ATL-251",
    summary: "EU hosting timeline",
    body: "Our procurement team needs a date for EU hosting.",
    reply: "We will ship regional hosting in Atlas 2.8, tracked in {ATL-251}.",
  },
  {
    id: "103",
    customer: 5,
    work: "ATL-265",
    summary: "Audit export for next year's review",
    body: "Is the audit export planned?",
    reply:
      "We will aim to make audit export available in Q1 2027, tracked in {ATL-265}.",
  },
];
const contacts = [
  "Priya Shah",
  "Jonas Weber",
  "Camille Laurent",
  "Ana Costa",
  "Ravi Menon",
  "Lena Fischer",
];

async function configureFields(supportProject: string | null) {
  const fields = (await call(route`/rest/api/3/field`)) as unknown as Json[];
  const sprintField =
    fields.find(
      (f) => f.schema?.custom === "com.pyxis.greenhopper.jira:gh-sprint",
    )?.id ?? "";
  const flagField = fields.find(
    (f) =>
      f.name === "Flagged" &&
      String(f.schema?.custom ?? "").includes("multicheckboxes"),
  )?.id;
  const settings = await getSettings();
  const next = settingsSchema.parse({
    ...settings,
    sprintField: /^customfield_\d+$/.test(sprintField)
      ? sprintField
      : settings.sprintField,
    flagField: flagField ?? settings.flagField,
    captureProjects: [
      ...new Set([
        ...settings.captureProjects,
        ...(supportProject ? [supportProject] : []),
      ]),
    ],
  });
  await kvs.set("kept:settings", next);
  return next;
}

export async function loadDemo(
  workProject: string,
  supportProject: string | null,
  actor: Person,
  now: string,
) {
  // Forge resolvers stop at 25 s. Each call does what fits in about 16 s; the page calls again until done.
  const started = Date.now();
  const late = () => Date.now() - started > 16000;
  const settings = await configureFields(supportProject);
  const info = await call(route`/rest/api/3/project/${workProject}`);
  const types = info.issueTypes as {
    id: string;
    name: string;
    subtask: boolean;
  }[];
  const type =
    types.find((t) => !t.subtask && /^(story|task)$/i.test(t.name)) ??
    types.find((t) => !t.subtask);
  if (!type) throw new Error("The work project needs a standalone work type");
  const base = (await call(route`/rest/api/3/serverInfo`)).baseUrl as string;
  const today = localDay(now, "Europe/Paris");
  const days = Temporal.PlainDate.from("2026-11-02").until(
    Temporal.PlainDate.from(today),
  ).days;
  const shift = (on: string) =>
    Temporal.PlainDate.from(on).add({ days }).toString();

  // 1. Releases and the delivery work behind every promise.
  const versionIds = new Map<string, string>();
  for (const v of releases)
    versionIds.set(
      v.id,
      await once(`kept:demo-version:${workProject}:${v.id}`, async () =>
        String(
          (
            await call(route`/rest/api/3/version`, {
              method: "POST",
              body: JSON.stringify({
                projectId: Number(info.id),
                name: v.name,
                releaseDate: v.releaseOn ? shift(v.releaseOn) : undefined,
                released: v.released,
              }),
            })
          ).id,
        ),
      ),
    );
  const workKeys = new Map<string, string>();
  for (const work of initialWork) {
    const key = await once(
      `kept:demo-work:${workProject}:${work.key}`,
      async () => {
        const ids = work.versions.flatMap((v) =>
          versionIds.get(v.id) ? [versionIds.get(v.id)!] : [],
        );
        const created = await call(route`/rest/api/3/issue`, {
          method: "POST",
          body: JSON.stringify({
            fields: {
              project: { key: workProject },
              issuetype: { id: type.id },
              summary: work.title,
              labels: ["kept-demo"],
              ...(ids.length ? { fixVersions: ids.map((id) => ({ id })) } : {}),
              ...(work.blocked && settings.flagField
                ? { [settings.flagField]: [{ value: "Impediment" }] }
                : {}),
            },
          }),
        });
        return created.key as string;
      },
    );
    workKeys.set(work.key, key);
    const ready = `kept:demo-work-ready:${workProject}:${work.key}`;
    if (await kvs.get(ready)) continue;
    if (work.status === "done") {
      const issue = await call(route`/rest/api/3/issue/${key}?fields=status`);
      if (issue.fields?.status?.statusCategory?.key !== "done") {
        const { transitions } = await call(
          route`/rest/api/3/issue/${key}/transitions`,
        );
        const done = (transitions as Json[]).find(
          (t) => t.to?.statusCategory?.key === "done",
        );
        if (done)
          await call(route`/rest/api/3/issue/${key}/transitions`, {
            method: "POST",
            body: JSON.stringify({ transition: { id: done.id } }),
          });
      }
    }
    if (!settings.flagField)
      await call(route`/rest/api/3/issue/${key}/properties/kept-planning`, {
        method: "PUT",
        body: JSON.stringify({
          blocked: work.blocked ?? false,
          observedAt: now,
        }),
      });
    if (!(await readWorkSnapshot(key)))
      await saveWorkSnapshot(await readWork(key, now), 0);
    await kvs.set(ready, true);
    if (late()) return { done: false, created: 0, inbox: 0 };
  }
  const fill = (text: string, date: string, key: string) =>
    text
      .replace("{date}", written(date))
      .replace("{key}", key)
      .replace("{date248}", written(shift("2026-11-06")))
      .replace(/\{(ATL-\d+)\}/g, (_, k: string) => workKeys.get(k) ?? k);

  // 2. Customers and their support requests, answered by a public reply.
  let desk: { id: string; requestType: string } | null = null;
  if (supportProject) {
    const desks = await call(route`/rest/servicedeskapi/servicedesk?limit=100`);
    const found = (desks.values as Json[]).find(
      (d) => d.projectKey === supportProject,
    );
    if (!found) throw new Error(`${supportProject} is not a service project`);
    const requestTypes = await call(
      route`/rest/servicedeskapi/servicedesk/${found.id}/requesttype`,
    );
    const requestType =
      (requestTypes.values as Json[]).find((t) =>
        /question|support|help/i.test(t.name),
      ) ?? (requestTypes.values as Json[])[0];
    if (!requestType) throw new Error(`${supportProject} has no request type`);
    desk = { id: String(found.id), requestType: String(requestType.id) };
  }
  const request = async (
    marker: string,
    customerIndex: number,
    summary: string,
    body: string,
    reply: string,
  ) => {
    const listed = customers[customerIndex]!;
    const customer: Customer = {
      ...listed,
      renewalOn: listed.renewalOn ? shift(listed.renewalOn) : null,
    };
    const key = await once(`kept:demo-source:${marker}`, async () => {
      if (desk) {
        const created = await call(route`/rest/servicedeskapi/request`, {
          method: "POST",
          body: JSON.stringify({
            serviceDeskId: desk.id,
            requestTypeId: desk.requestType,
            requestFieldValues: {
              summary,
              description: `${body}

${contacts[customerIndex]}, ${customer.name}`,
            },
          }),
        });
        return created.issueKey as string;
      }
      const created = await call(route`/rest/api/3/issue`, {
        method: "POST",
        body: JSON.stringify({
          fields: {
            project: { key: workProject },
            issuetype: { id: type.id },
            summary: `${customer.name}: ${summary}`,
            labels: ["kept-demo"],
            description: doc(body),
          },
        }),
      });
      return created.key as string;
    });
    await call(route`/rest/api/3/issue/${key}/properties/kept-customer`, {
      method: "PUT",
      body: JSON.stringify(customer),
    });
    const commentId = await once(`kept:demo-reply:${marker}`, async () => {
      if (desk)
        return String(
          (
            await call(route`/rest/servicedeskapi/request/${key}/comment`, {
              method: "POST",
              body: JSON.stringify({ body: reply, public: true }),
            })
          ).id,
        );
      return String(
        (
          await call(route`/rest/api/3/issue/${key}/comment`, {
            method: "POST",
            body: JSON.stringify({ body: doc(reply) }),
          })
        ).id,
      );
    });
    const source: Source = desk
      ? (await readSource(key, commentId)).source
      : {
          id: commentId,
          issueKey: key,
          body: reply,
          public: true,
          author: actor,
          createdAt: now,
          updatedAt: now,
          url: `${base}/browse/${key}?focusedCommentId=${commentId}`,
        };
    return { key, commentId, source, customer };
  };

  // 3. Confirmed promises, plus three replies waiting in the capture inbox.
  let count = 0;
  for (const [n, title, customerIndex, work, due] of promises) {
    const id = `KPT-${workProject}-${n}`;
    if (await read(id)) {
      count++;
      continue;
    }
    const delivered = n === "007";
    const dueOn = delivered
      ? Temporal.PlainDate.from(today).add({ days: 1 }).toString()
      : shift(due);
    const workKey = workKeys.get(work)!;
    const ask = asks[title]!;
    const made = await request(
      `${workProject}:${n}`,
      customerIndex,
      ask.summary,
      ask.body,
      fill(ask.reply, dueOn, workKey),
    );
    if (!(await read(id))) {
      const at = new Date(
        Math.max(Date.now(), Date.parse(made.source.updatedAt)),
      ).toISOString();
      let record = await confirm(
        {
          id,
          title,
          customer: made.customer,
          owner: actor,
          source: made.source,
          excerpt: made.source.body,
          workKeys: [workKey],
          dueOn,
          timezone: "Europe/Paris",
          synthetic: true,
        },
        actor.id,
        at,
      );
      await save(record, 0);
      if (delivered) {
        const next = await apply(
          record,
          {
            action: "deliver",
            at,
            url: made.source.url,
            note: "Customer confirmed invoice history is visible in their portal.",
          },
          actor.id,
          at,
        );
        await save(next, record.version);
        record = next;
      }
    }
    count++;
    if (late()) return { done: false, created: count, inbox: 0 };
  }
  for (const item of incoming) {
    const marker = `kept:demo-inbox:${workProject}:${item.id}`;
    if (await kvs.get(marker)) continue;
    const made = await request(
      `${workProject}:${item.id}`,
      item.customer,
      item.summary,
      item.body,
      fill(item.reply, shift("2026-11-06"), workKeys.get(item.work)!),
    );
    if (desk) await rememberSource(made.key, made.commentId);
    await kvs.set(marker, true);
    if (late()) return { done: false, created: count, inbox: 0 };
  }
  return { done: true, created: count, inbox: desk ? incoming.length : 0 };
}
