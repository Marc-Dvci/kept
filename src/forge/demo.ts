import api, { route } from "@forge/api";
import { kvs } from "@forge/kvs";
import { Temporal } from "@js-temporal/polyfill";
import { seed, initialWork, releases } from "../demo/data";
import { localDay, type Person, type Work } from "../core/model";
import { confirm, apply } from "../core/ledger";
import { save, read, readWorkSnapshot, saveWorkSnapshot } from "./store";
export async function loadDemo(project: string, actor: Person, now: string) {
  const p = await api
    .asUser()
    .requestJira(route`/rest/api/3/project/${project}`);
  if (!p.ok) throw new Error("The demo project is unavailable");
  const info = (await p.json()) as {
    id: string;
    issueTypes: { id: string; subtask: boolean }[];
  };
  const type = info.issueTypes.find((t) => !t.subtask);
  if (!type) throw new Error("The demo project needs a standalone issue type");
  const baseResponse = await api
    .asUser()
    .requestJira(route`/rest/api/3/serverInfo`);
  if (!baseResponse.ok) throw new Error("The Jira site URL is unavailable");
  const base = ((await baseResponse.json()) as { baseUrl: string }).baseUrl;
  const days = Temporal.PlainDate.from("2026-11-02").until(
    Temporal.PlainDate.from(localDay(now, "Europe/Paris")),
  ).days;
  const shift = (on: string) =>
    Temporal.PlainDate.from(on).add({ days }).toString();
  async function issue(
    marker: string,
    title: string,
    versionIds: string[] = [],
  ) {
    const old = await kvs.get<string>(marker);
    if (old) return old;
    const response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: project },
          issuetype: { id: type!.id },
          summary: `[Kept synthetic] ${title}`,
          labels: ["kept-synthetic"],
          ...(versionIds.length
            ? { fixVersions: versionIds.map((id) => ({ id })) }
            : {}),
        },
      }),
    });
    if (!response.ok)
      throw new Error(
        `Synthetic demo creation stopped (HTTP ${response.status}). Existing item markers are retained.`,
      );
    const key = ((await response.json()) as { key: string }).key;
    await kvs.set(marker, key);
    return key;
  }
  const versionMap = new Map<string, string>();
  for (const v of releases) {
    const marker = `kept:demo-version:${project}:${v.id}`;
    let id = await kvs.get<string>(marker);
    if (!id) {
      const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/version`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: Number(info.id),
            name: `Kept demo ${v.name}`,
            releaseDate: v.releaseOn ? shift(v.releaseOn) : undefined,
            released: v.released,
          }),
        });
      if (!response.ok)
        throw new Error(
          "Creating synthetic versions requires project administration permission",
        );
      id = String(((await response.json()) as { id: string }).id);
      await kvs.set(marker, id);
    }
    versionMap.set(v.id, id);
  }
  const workMap = new Map<string, string>();
  for (const work of initialWork) {
    const key = await issue(
      `kept:demo-work:${project}:${work.key}`,
      work.title,
      work.versions.flatMap((v) =>
        versionMap.get(v.id) ? [versionMap.get(v.id)!] : [],
      ),
    );
    workMap.set(work.key, key);
    const observation: Work = {
      ...work,
      key,
      url: `${base}/browse/${key}`,
      observedAt: now,
      updatedAt: now,
      versions: work.versions.map((v) => ({
        ...v,
        id: versionMap.get(v.id) ?? `kept-demo-${v.id}`,
        name: `Kept demo ${v.name}`,
        releaseOn: v.releaseOn ? shift(v.releaseOn) : null,
      })),
    };
    if (!(await readWorkSnapshot(key))) await saveWorkSnapshot(observation, 0);
    const property = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${key}/properties/kept-planning`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: work.blocked, observedAt: now }),
      });
    if (!property.ok)
      throw new Error("The synthetic planning observation could not be saved");
  }
  let count = 0;
  for (const original of await seed()) {
    const id = `KPT-${project}-${original.data.id.slice(4)}`;
    if (await read(id)) {
      count++;
      continue;
    }
    const key = await issue(
      `kept:demo-source:${project}:${id}`,
      `${original.data.customer.name}: ${original.data.title}`,
    );
    const dueOn = original.data.delivery
      ? Temporal.PlainDate.from(localDay(now, "Europe/Paris"))
          .add({ days: 1 })
          .toString()
      : shift(original.data.dueOn);
    const body = `SYNTHETIC DEMONSTRATION. We will deliver ${original.data.title.toLowerCase()} by ${dueOn}, tracked in ${original.data.workKeys.map((k) => workMap.get(k)).join(", ")}.`;
    const marker = `kept:demo-comment:${project}:${id}`;
    let commentId = await kvs.get<string>(marker);
    if (!commentId) {
      const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${key}/comment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: {
              type: "doc",
              version: 1,
              content: [
                { type: "paragraph", content: [{ type: "text", text: body }] },
              ],
            },
          }),
        });
      if (!response.ok)
        throw new Error("The synthetic source comment could not be created");
      commentId = String(((await response.json()) as { id: string }).id);
      await kvs.set(marker, commentId);
    }
    let record = await confirm(
      {
        id,
        title: original.data.title,
        customer: {
          ...original.data.customer,
          renewalOn: original.data.customer.renewalOn
            ? shift(original.data.customer.renewalOn)
            : null,
        },
        owner: actor,
        source: {
          id: commentId,
          issueKey: key,
          body,
          public: true,
          author: actor,
          createdAt: now,
          updatedAt: now,
          url: `${base}/browse/${key}?focusedCommentId=${commentId}`,
        },
        excerpt: body,
        workKeys: original.data.workKeys.map((k) => workMap.get(k)!),
        dueOn,
        timezone: "Europe/Paris",
        synthetic: true,
      },
      actor.id,
      now,
    );
    await save(record, 0);
    if (original.data.delivery) {
      const next = await apply(
        record,
        {
          action: "deliver",
          at: now,
          url: `${base}/browse/${key}`,
          note: "Synthetic demonstration of customer availability evidence, reviewed by the installing user.",
        },
        actor.id,
        now,
      );
      await save(next, record.version);
      record = next;
    }
    count++;
  }
  return {
    created: count,
    disclaimer:
      "Synthetic sources and planning observations. Verify genuine JSM public-reply capture separately.",
  };
}
