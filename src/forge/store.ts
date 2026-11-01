import { kvs, Filter, FilterConditions, WhereConditions } from "@forge/kvs";
import { verify, canonical, type RecordState } from "../core/ledger";
import type { Work } from "../core/model";
export type WorkSnapshot = { version: number; data: Work };
export const readWorkSnapshot = (key: string) =>
  kvs.entity<WorkSnapshot>("work").get(key);
export async function saveWorkSnapshot(work: Work, expected: number) {
  await kvs
    .transact()
    .set(
      work.key,
      { version: expected + 1, data: work },
      {
        entityName: "work",
        conditions: new Filter<WorkSnapshot>().and(
          "version",
          expected === 0
            ? FilterConditions.notExists()
            : FilterConditions.equalTo(expected),
        ),
      },
    )
    .execute();
}
export const read = (id: string) => kvs.entity<RecordState>("promise").get(id);
export async function save(record: RecordState, expected: number) {
  if (!(await verify(record)))
    throw new Error("The promise history is inconsistent");
  if (new TextEncoder().encode(canonical(record)).length > 220000)
    throw new Error(
      "This promise is near its safe record size. Retain an evidence bundle and create a linked follow-up record.",
    );
  if (record.version !== expected + 1)
    throw new Error("A new event version is required");
  try {
    const transaction = kvs
      .transact()
      .set(record.data.id, record, {
        entityName: "promise",
        conditions: new Filter<RecordState>().and(
          "version",
          expected === 0
            ? FilterConditions.notExists()
            : FilterConditions.equalTo(expected),
        ),
      })
      .set(`kept:index:${record.data.id}`, { id: record.data.id });
    for (const key of record.data.workKeys)
      transaction.set(`kept:linked:${key}:${record.data.id}`, {
        id: record.data.id,
      });
    await transaction.execute();
  } catch {
    throw new Error(
      "The promise could not be committed. Refresh before retrying; another session or a storage outage may be responsible.",
    );
  }
}
export async function linkedIds(key: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const query = kvs
      .query()
      .where("key", WhereConditions.beginsWith(`kept:linked:${key}:`))
      .limit(100);
    const page = await (cursor ? query.cursor(cursor) : query).getMany<{
      id: string;
    }>();
    ids.push(...page.results.map((r) => r.value.id));
    cursor = page.nextCursor;
    if (ids.length > 500)
      throw new Error(
        "The linked-promise population exceeds this prototype's safe scope",
      );
  } while (cursor);
  return ids;
}
export async function keys(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const q = kvs
      .query()
      .where("key", WhereConditions.beginsWith("kept:index:"))
      .limit(100);
    const page = await (cursor ? q.cursor(cursor) : q).getMany<{
      id: string;
    }>();
    ids.push(...page.results.map((r) => r.value.id));
    cursor = page.nextCursor;
    if (ids.length > 500)
      throw new Error(
        "The prototype supports at most 500 managed promises per population view. Narrow the deployment scope.",
      );
  } while (cursor);
  return ids;
}
