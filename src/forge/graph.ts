import { graph, type types } from "@forge/teamwork-graph";
import { kvs } from "@forge/kvs";
import { z } from "zod";
import type { PromiseRecord } from "../core/model";
export function documents(
  promises: PromiseRecord[],
  now: string,
): types.DocumentObject[] {
  if (promises.some((p) => !p.synthetic))
    throw new Error(
      "Teamwork Graph sync covers the demo promises",
    );
  return promises.map((p) => ({
    schemaVersion: "1.0",
    id: `kept-${p.id}`,
    updateSequenceNumber: Date.parse(now),
    displayName: `${p.customer.name}: ${p.title} · Kept demo promise`,
    description:
      "Kept demo promise: customer, agreed date, linked Jira work and source reply.",
    url: p.source.url,
    createdAt: p.confirmedAt,
    lastUpdatedAt: now,
    permissions: [
      {
        accessControls: [
          { principals: [{ type: "ATLASSIAN_WORKSPACE" as const }] },
        ],
      },
    ],
    "atlassian:document": {
      type: { category: "DOCUMENT", mimeType: "text/plain" },
      content: {
        mimeType: "text/plain",
        text: `Kept demo promise. ${p.customer.name} was promised ${p.title} by ${p.dueOn}. Linked Jira work: ${p.workKeys.join(", ")}. Source: ${p.source.url}.`,
      },
      labels: ["kept", "demo", "customer-promise"],
    },
  }));
}
export async function sync(promises: PromiseRecord[], now: string) {
  const connectionId = await kvs.get<string>("kept:graph-connection");
  if (!connectionId)
    throw new Error(
      "Connect Kept in Atlassian Administration > Connected apps > Connections first",
    );
  const result = await graph.setObjects({
    connectionId,
    objects: documents(promises, now),
  });
  if (!result.success || (result.results?.rejected?.length ?? 0) > 0)
    throw new Error("Teamwork Graph rejected one or more promise documents");
  const status = { accepted: result.results?.accepted?.length ?? 0, at: now };
  await kvs.set("kept:graph-status", status);
  return status;
}
export async function onConnectionChange(event: unknown) {
  const parsed = z
    .object({
      action: z.enum(["CREATED", "UPDATED", "DELETED"]),
      connectionId: z.string().min(1),
    })
    .parse((event as { body?: unknown }).body ?? event);
  if (parsed.action === "DELETED") {
    if ((await kvs.get("kept:graph-connection")) === parsed.connectionId) {
      await kvs.delete("kept:graph-connection");
      await kvs.delete("kept:graph-status");
    }
  } else await kvs.set("kept:graph-connection", parsed.connectionId);
}
