// Backed by real Zapier + Claude calls (see zapier-server.ts for the Zapier
// SDK singleton and connection persistence notes). Types below are the
// shared contract with the UI — keep them stable.

import { createServerFn } from "@tanstack/react-start";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The structured-output helper converts the schema via zod's v4 JSON-schema
// exporter, which can't read a schema built with the project's top-level
// (v3) "zod" import — this subpath is zod's own v4 compatibility build.
import { z } from "zod/v4";
import {
  getZapierSdk,
  resolveConnectionMap,
  type ZapierActionType,
  type ZapierSdkInstance,
} from "@/lib/zapier-server";

export type ConnectedApp = {
  id: string;
  name: string;
  category: string;
  actionCount: number;
  connectedAt: string;
};

export type ActionParam = {
  key: string;
  label: string;
  value: string;
  required: boolean;
  multiline?: boolean;
};

export type ProposedAction = {
  id: string;
  appId: string;
  appName: string;
  actionType: string; // e.g. "Send Email"
  summary: string; // plain-English "what it'll do"
  params: ActionParam[];
  sourceQuote: string; // exact substring from transcript
  confidence: number;
};

const SAMPLE_TRANSCRIPT = `[00:02] Jamie (Acme): Thanks for jumping on, Priya. Quick recap — we've been evaluating three vendors for the Q3 migration and honestly, your platform is the front-runner.
[00:41] Priya (us): Appreciate that. What's the decision timeline looking like?
[01:03] Jamie: Legal review kicks off Monday. If we can get the redlined MSA back to me by Thursday, we're on track to sign end of month.
[01:29] Priya: I'll get the MSA over to you today with our standard redlines. I'll also loop in our solutions engineer, Marcus, on the technical scoping call.
[02:14] Jamie: Perfect. Can you send a calendar invite for the technical deep-dive? Tuesday 2pm ET works for me and my head of infra, David Chen — david.chen@acme.co.
[02:47] Priya: Done. I'll also drop a note in our shared Slack channel so the wider account team is aware we're moving to procurement.
[03:12] Jamie: One more thing — add me to your customer newsletter list. And it'd be great if someone from your CS team could reach out to my colleague Sarah Reyes at sarah@acme.co, she's leading a parallel eval for our EMEA org.
[03:44] Priya: All noted. Talk Thursday.`;

export const SAMPLE_TRANSCRIPT_TEXT = SAMPLE_TRANSCRIPT;

export type ExecutionResult = {
  actionId: string;
  status: "succeeded" | "failed";
  message: string;
  ranAt: string;
};

/* ─────────────────────── getConnections ─────────────────────── */

const getConnectionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConnectedApp[]> => {
    const zapier = getZapierSdk();

    const latestByApp = new Map<
      string,
      { id: string | number; date: string; title?: string | null }
    >();
    for await (const conn of zapier.listConnections().items()) {
      const appKey = conn.app_key;
      if (!appKey) continue;
      const existing = latestByApp.get(appKey);
      if (!existing || new Date(conn.date).getTime() > new Date(existing.date).getTime()) {
        latestByApp.set(appKey, conn);
      }
    }

    return Promise.all(
      [...latestByApp.entries()].map(async ([appKey, conn]): Promise<ConnectedApp> => {
        let name = conn.title ?? appKey;
        let category = "Other";
        let actionCount = 0;
        try {
          const { data: app } = await zapier.getApp({ appKey });
          name = app.title ?? name;
          category = app.categories?.[0]?.name ?? category;
          actionCount = Object.values(app.actions ?? {}).reduce(
            (sum: number, n) => sum + (n ?? 0),
            0,
          );
        } catch {
          // App metadata is best-effort — still surface the connection.
        }
        return { id: appKey, name, category, actionCount, connectedAt: conn.date };
      }),
    );
  },
);

export async function getConnections(): Promise<ConnectedApp[]> {
  return getConnectionsFn();
}

/* ─────────────────────── analyzeTranscript ─────────────────────── */

const ExtractionSchema = z.object({
  actions: z.array(
    z.object({
      ref: z.string().describe("The exact 'ref' of the matched catalog action"),
      summary: z.string().describe("One-sentence plain-English description of what will run"),
      sourceQuote: z
        .string()
        .describe("An exact, verbatim, contiguous substring of the transcript"),
      confidence: z.number().min(0).max(1),
      params: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          value: z.string(),
        }),
      ),
    }),
  ),
});

type CatalogEntry = {
  ref: string;
  appKey: string;
  appName: string;
  actionType: ZapierActionType;
  actionKey: string;
  title: string;
  description: string;
};

async function buildActionCatalog(
  zapier: ZapierSdkInstance,
  appKeys: string[],
): Promise<CatalogEntry[]> {
  const catalog: CatalogEntry[] = [];
  for (const appKey of appKeys) {
    let appName = appKey;
    try {
      const { data: app } = await zapier.getApp({ appKey });
      appName = app.title ?? appKey;
    } catch {
      // Fall back to the raw key if app metadata can't be loaded.
    }
    for await (const action of zapier.listActions({ appKey, maxItems: 200 }).items()) {
      catalog.push({
        ref: `${appKey}::${action.action_type}::${action.key}`,
        appKey,
        appName,
        actionType: action.action_type,
        actionKey: action.key,
        title: action.title,
        description: action.description ?? "",
      });
    }
  }
  return catalog;
}

function buildSystemPrompt(catalog: CatalogEntry[]): string {
  const catalogForPrompt = catalog.map((c) => ({
    ref: c.ref,
    app: c.appName,
    title: c.title,
    description: c.description,
  }));
  return `You read call and meeting transcripts and propose concrete follow-up actions a rep can run through their connected apps.

Only propose actions that match an entry from this action catalog exactly by "ref" — never invent an action that isn't listed:
${JSON.stringify(catalogForPrompt)}

Rules:
- Every proposed action must be clearly and specifically grounded in the transcript. Do not invent action items the transcript doesn't support.
- "sourceQuote" must be an exact, verbatim, contiguous substring of the transcript — same wording, casing, and punctuation — because it is used to highlight the source phrase. Do not paraphrase, summarize, or trim it.
- "params" should cover the input fields a person would need to fill in to run the action (recipient, subject, body, channel, message, date, etc.), inferred from context. Use "" for a value you can't determine from the transcript.
- "confidence" is a 0-1 score reflecting how clearly the transcript supports the action.
- Don't propose duplicate actions for the same thing.
- It's fine to return zero actions if nothing in the transcript warrants one.`;
}

/** Encodes the Zapier routing info needed to later execute this action into
 * the opaque `id` field, since ProposedAction has no field for it. */
function encodeActionId(entry: Pick<CatalogEntry, "appKey" | "actionType" | "actionKey">): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return [entry.appKey, entry.actionType, entry.actionKey, suffix]
    .map(encodeURIComponent)
    .join("|");
}

function decodeActionId(
  id: string,
): { appKey: string; actionType: string; actionKey: string } | null {
  const parts = id.split("|");
  if (parts.length < 3) return null;
  const [appKey, actionType, actionKey] = parts.map(decodeURIComponent);
  return { appKey, actionType, actionKey };
}

const analyzeTranscriptFn = createServerFn({ method: "POST" })
  .validator((transcript: unknown): string => {
    if (typeof transcript !== "string" || !transcript.trim()) {
      throw new Error("transcript must be a non-empty string");
    }
    return transcript;
  })
  .handler(async ({ data: transcript }): Promise<ProposedAction[]> => {
    const zapier = getZapierSdk();
    const connectionMap = await resolveConnectionMap(zapier);
    const appKeys = Object.keys(connectionMap);
    if (appKeys.length === 0) return [];

    const catalog = await buildActionCatalog(zapier, appKeys);
    if (catalog.length === 0) return [];
    const catalogByRef = new Map(catalog.map((c) => [c.ref, c]));

    const anthropic = new Anthropic();
    const response = await anthropic.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 8192,
      system: buildSystemPrompt(catalog),
      messages: [{ role: "user", content: transcript }],
      output_config: { format: zodOutputFormat(ExtractionSchema) },
    });

    const proposals = response.parsed_output?.actions ?? [];
    const validated: ProposedAction[] = [];

    for (const proposal of proposals) {
      const entry = catalogByRef.get(proposal.ref);
      if (!entry) continue; // not a real catalog action — drop
      if (!transcript.includes(proposal.sourceQuote)) continue; // quote must be real — drop

      const connectionId = connectionMap[entry.appKey];
      if (connectionId === undefined) continue;

      let requiredKeys: string[] = [];
      let fieldLabels: Record<string, string> = {};
      try {
        const inputs = Object.fromEntries(proposal.params.map((p) => [p.key, p.value]));
        const { data: schema } = await zapier.getActionInputFieldsSchema({
          appKey: entry.appKey,
          actionType: entry.actionType,
          actionKey: entry.actionKey,
          connection: connectionId,
          inputs,
        });
        const properties = (schema?.properties as Record<string, { title?: string }>) ?? {};
        requiredKeys = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
        fieldLabels = Object.fromEntries(
          Object.entries(properties).map(([key, field]) => [key, field?.title ?? key]),
        );
      } catch {
        // Can't validate this action's inputs — drop it rather than
        // proposing something that isn't runnable.
        continue;
      }

      const paramsByKey = new Map(proposal.params.map((p) => [p.key, p]));
      const allKeys = new Set([...paramsByKey.keys(), ...requiredKeys]);
      const params: ActionParam[] = [...allKeys].map((key) => {
        const claimed = paramsByKey.get(key);
        return {
          key,
          label: claimed?.label ?? fieldLabels[key] ?? key,
          value: claimed?.value ?? "",
          required: requiredKeys.includes(key),
        };
      });

      validated.push({
        id: encodeActionId(entry),
        appId: entry.appKey,
        appName: entry.appName,
        actionType: entry.title,
        summary: proposal.summary,
        params,
        sourceQuote: proposal.sourceQuote,
        confidence: Math.max(0, Math.min(1, proposal.confidence)),
      });
    }

    return validated;
  });

export async function analyzeTranscript(transcript: string): Promise<ProposedAction[]> {
  return analyzeTranscriptFn({ data: transcript });
}

/* ─────────────────────── executeActions ─────────────────────── */

const executeActionsFn = createServerFn({ method: "POST" })
  .validator((actions: unknown): ProposedAction[] => actions as ProposedAction[])
  .handler(async ({ data: actions }): Promise<ExecutionResult[]> => {
    const zapier = getZapierSdk();
    const connectionMap = await resolveConnectionMap(zapier);

    const results: ExecutionResult[] = [];
    for (const action of actions) {
      const ranAt = new Date().toISOString();
      const ref = decodeActionId(action.id);
      if (!ref) {
        results.push({
          actionId: action.id,
          status: "failed",
          message: "Could not resolve this action's Zapier reference.",
          ranAt,
        });
        continue;
      }

      const connectionId = connectionMap[ref.appKey];
      if (connectionId === undefined) {
        results.push({
          actionId: action.id,
          status: "failed",
          message: `No Zapier connection found for ${ref.appKey}.`,
          ranAt,
        });
        continue;
      }

      try {
        const inputs = Object.fromEntries(action.params.map((p) => [p.key, p.value]));
        await zapier.apps[ref.appKey][ref.actionType][ref.actionKey]({
          connection: connectionId,
          inputs,
        });
        results.push({
          actionId: action.id,
          status: "succeeded",
          message: `${action.actionType} completed via ${action.appName}.`,
          ranAt,
        });
      } catch (error) {
        results.push({
          actionId: action.id,
          status: "failed",
          message: error instanceof Error ? error.message : "Zapier action failed.",
          ranAt,
        });
      }
    }
    return results;
  });

export async function executeActions(actions: ProposedAction[]): Promise<ExecutionResult[]> {
  return executeActionsFn({ data: actions });
}
