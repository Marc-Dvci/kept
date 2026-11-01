import api, { route } from "@forge/api";
import { issueKey } from "../core/model";
export type Context = {
  accountId?: string;
  extension?: { issue?: { key?: string } };
  [key: string]: unknown;
};
export class Inaccessible extends Error {}
export function actor(context: Context) {
  if (!context.accountId) throw new Error("Sign in to Atlassian to continue");
  return context.accountId;
}
export async function readable(key: string, context: Context) {
  actor(context);
  issueKey.parse(key);
  const r = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${key}?fields=summary`);
  if (r.status === 403 || r.status === 404)
    throw new Inaccessible("This work item is unavailable or inaccessible");
  if (!r.ok)
    throw new Error(
      `Jira access check failed (HTTP ${r.status}). The population could not be checked completely.`,
    );
}
export async function permission(name: string, key?: string) {
  const r = await api
    .asUser()
    .requestJira(
      key
        ? route`/rest/api/3/mypermissions?issueKey=${key}&permissions=${name}`
        : route`/rest/api/3/mypermissions?permissions=${name}`,
    );
  if (!r.ok)
    throw new Error(
      "Jira permissions are unavailable; retry when the site is available",
    );
  const b = (await r.json()) as {
    permissions?: Record<string, { havePermission: boolean }>;
  };
  return b.permissions?.[name]?.havePermission === true;
}
export async function editable(key: string, context: Context) {
  await readable(key, context);
  if (!(await permission("EDIT_ISSUES", key)))
    throw new Error(
      "Jira Edit Issues permission on the source request is required",
    );
}
export async function admin(context: Context) {
  actor(context);
  if (!(await permission("ADMINISTER")))
    throw new Error("Jira administrator permission is required");
}
export async function bounded<T, R>(
  values: T[],
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let n = 0; n < values.length; n += 5) {
    const batch = await Promise.allSettled(values.slice(n, n + 5).map(fn));
    for (const result of batch)
      if (result.status === "fulfilled") out.push(result.value);
      else if (!(result.reason instanceof Inaccessible)) throw result.reason;
  }
  return out;
}
