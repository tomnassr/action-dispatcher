// Framework-agnostic core. Nothing in this file imports TanStack Start,
// React, or anything else specific to this demo app — it only depends on
// @zapier/zapier-sdk (via zapier-server.ts) and zod. Copy this file plus
// zapier-server.ts into any Node/edge backend (Express, Next.js route
// handlers, a plain Cloudflare Worker, whatever) and call the three
// exported functions directly; there's no createServerFn/TanStack wrapper
// to strip out.
//
// Each function reads its Zapier credentials and connection ids from the
// environment at call time (see zapier-server.ts) — nothing is baked in at
// build time, so every clone of this repo (or every consumer of this file)
// authenticates as whoever's ZAPIER_CREDENTIALS / ZAPIER_CONNECTION_IDS are
// set in their own environment.

import { z } from "zod";
import {
  getZapierSdk,
  runAiByZapierPrompt,
  type ZapierActionType,
  type ZapierSdkInstance,
} from "./zapier-server";

/**
 * One authorized Zapier connection — a specific account for an app. A single
 * app (e.g. Gmail) can have several of these (tom@, vazul@, …), so actions
 * must be run against a chosen connection, not just an app.
 */
export type ConnectedAccount = {
  /** The Zapier connection id — the thing actions actually run against. */
  connectionId: string;
  /** App implementation key, e.g. "GoogleMailV2CLIAPI". Shared across a
   * given app's accounts. */
  appKey: string;
  /** Human app name, e.g. "Gmail". */
  appName: string;
  /** Which account this connection is — an email where Zapier exposes one
   * (Gmail), else the connection title (Slack workspace name, etc.). */
  accountLabel: string;
  category: string;
  actionCount: number;
  /** Zapier flags this connection as shared with the account's team. */
  isShared: boolean;
  /** True when this connection's app-provided identifier looks like a legacy
   * duplicate (title contains "(Legacy)" or an old version tag). Surfaced so
   * the UI can de-emphasize or hide them. */
  isLegacy: boolean;
  connectedAt: string;
};

/** App-level summary used by the connect screen's chip list. Derived from the
 * per-account connections by collapsing an app's accounts into one entry. */
export type ConnectedApp = {
  id: string;
  name: string;
  category: string;
  actionCount: number;
  /** How many distinct accounts are connected for this app. */
  accountCount: number;
  connectedAt: string;
};

export type ParamChoice = { value: string; label: string };

export type ActionParam = {
  key: string;
  label: string;
  value: string;
  required: boolean;
  multiline?: boolean;
  /** For fields that target a specific account-owned resource (Slack channel,
   * Trello board, Notion database, …): the real options the account has access
   * to. `value` is one of these choices' `value` (the id Zapier expects), or ""
   * when the AI's target couldn't be matched — in which case the user picks. */
  choices?: ParamChoice[];
  /** True when this field is a dynamic resource selector (has `choices`). */
  dynamic?: boolean;
};

export type ProposedAction = {
  id: string;
  appId: string;
  appName: string;
  /** The account this action will run as (email / workspace name). Shown in
   * the review queue so the user sees exactly which connection fires. */
  accountLabel: string;
  actionType: string; // e.g. "Send Email"
  summary: string; // plain-English "what it'll do"
  params: ActionParam[];
  sourceQuote: string; // exact substring from transcript
  confidence: number;
};

export type ExecutionResult = {
  actionId: string;
  status: "succeeded" | "failed";
  message: string;
  ranAt: string;
};

/* ─────────────────────── getSdkStatus ─────────────────────── */

/** Whether the Zapier SDK is authenticated, and as whom. */
export type SdkStatus = {
  connected: boolean;
  /** Authenticated account email, when connected. */
  email?: string;
  /** Why the SDK isn't usable, when not connected (for logs/debugging). */
  error?: string;
};

/**
 * Checks whether the Zapier SDK has working credentials by fetching the
 * authenticated profile. A failure here means no CLI login / ZAPIER_CREDENTIALS
 * — the app should show setup instructions rather than the app UI.
 */
export async function getSdkStatus(): Promise<SdkStatus> {
  try {
    const zapier = getZapierSdk();
    const { data } = await zapier.getProfile();
    return { connected: true, email: data.email ?? undefined };
  } catch (error) {
    return {
      connected: false,
      error: error instanceof Error ? error.message : "Zapier SDK is not authenticated.",
    };
  }
}

/* ─────────────────────── getConnectedAccounts ─────────────────────── */

/** Derives the human account label for a connection: an email/identifier when
 * Zapier exposes one (Gmail), otherwise the connection title (Slack workspace,
 * etc.), falling back to the app name. */
function accountLabelFor(
  conn: { title?: string | null; identifier?: string | null },
  appName: string,
): string {
  return conn.identifier?.trim() || conn.title?.trim() || appName;
}

function looksLegacy(title?: string | null): boolean {
  return /\(legacy\)|\(\d+\.\d+/i.test(title ?? "");
}

/**
 * Returns EVERY authorized connection as its own account — not deduped by app.
 * A single app can have many accounts (e.g. several Gmail logins or Slack
 * workspaces), and an action has to run against one specific connection, so
 * the caller picks a connection rather than just an app.
 */
export async function getConnectedAccounts(): Promise<ConnectedAccount[]> {
  const zapier = getZapierSdk();

  type ConnRow = {
    id: string | number;
    app_key: string;
    date: string;
    title?: string | null;
    identifier?: string | null;
    is_shared?: unknown;
  };
  const conns: ConnRow[] = [];
  for await (const conn of zapier.listConnections().items()) {
    if (!conn.app_key) continue;
    conns.push({
      id: conn.id,
      app_key: conn.app_key,
      date: conn.date,
      title: conn.title,
      identifier: conn.identifier,
      is_shared: conn.is_shared,
    });
  }

  // App metadata (name/category/action count) is per app_key — fetch once per
  // distinct app and reuse across that app's accounts.
  const appMetaCache = new Map<string, { name: string; category: string; actionCount: number }>();
  async function appMeta(appKey: string) {
    const cached = appMetaCache.get(appKey);
    if (cached) return cached;
    let meta = { name: appKey, category: "Other", actionCount: 0 };
    try {
      const { data: app } = await zapier.getApp({ appKey });
      meta = {
        name: app.title ?? appKey,
        category: app.categories?.[0]?.name ?? "Other",
        actionCount: Object.values(app.actions ?? {}).reduce((sum: number, n) => sum + (n ?? 0), 0),
      };
    } catch {
      // Best-effort — still surface the connection with fallback metadata.
    }
    appMetaCache.set(appKey, meta);
    return meta;
  }

  const accounts = await Promise.all(
    conns.map(async (conn): Promise<ConnectedAccount> => {
      const meta = await appMeta(conn.app_key);
      return {
        connectionId: String(conn.id),
        appKey: conn.app_key,
        appName: meta.name,
        accountLabel: accountLabelFor(conn, meta.name),
        category: meta.category,
        actionCount: meta.actionCount,
        isShared: conn.is_shared === true || conn.is_shared === "true",
        isLegacy: looksLegacy(conn.title),
        connectedAt: conn.date,
      };
    }),
  );

  // Most recent first, so the newest account per app tends to surface first.
  accounts.sort((a, b) => new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime());
  return accounts;
}

/** App-level summary (one entry per app) derived from the per-account list —
 * used by the connect screen's chip list, which doesn't care about individual
 * accounts. */
export async function getConnections(): Promise<ConnectedApp[]> {
  const accounts = await getConnectedAccounts();
  const byApp = new Map<string, ConnectedApp>();
  for (const acct of accounts) {
    const existing = byApp.get(acct.appKey);
    if (!existing) {
      byApp.set(acct.appKey, {
        id: acct.appKey,
        name: acct.appName,
        category: acct.category,
        actionCount: acct.actionCount,
        accountCount: 1,
        connectedAt: acct.connectedAt,
      });
    } else {
      existing.accountCount += 1;
      if (new Date(acct.connectedAt).getTime() > new Date(existing.connectedAt).getTime()) {
        existing.connectedAt = acct.connectedAt;
      }
    }
  }
  return [...byApp.values()];
}

/* ─────────────────────── interactive connect flow ─────────────────────── */
//
// getConnections() only reads what's already connected. These three
// functions let a user connect a *new* app from inside the running app —
// Zapier's own hosted sign-in page, not a fake local delay — so a live demo
// can show someone authorizing with their own Zapier credentials. Nothing
// here is scoped to a fixed app list: search hits Zapier's full catalog.

export type ZapierAppSummary = {
  key: string;
  title: string;
};

/** Searches Zapier's full app catalog — not a fixed roster — so a user can
 * connect any of Zapier's ~9,000 integrations, not just a curated few. */
export async function searchZapierApps(query: string): Promise<ZapierAppSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const zapier = getZapierSdk();
  const { data: apps } = await zapier.listApps({ search: q, maxItems: 15 });
  return apps
    .filter((app) => !app.is_hidden)
    .map((app) => ({ key: app.slug ?? app.key, title: app.title }));
}

export type ZapierConnectStart = {
  appKey: string;
  url: string;
  startedAt: number;
};

/** Generates the Zapier-hosted authorization link for one app. The caller
 * opens `url` for the user to sign in and approve on Zapier's own page. */
export async function startZapierConnect(appKey: string): Promise<ZapierConnectStart> {
  const zapier = getZapierSdk();
  const { data } = await zapier.getConnectionStartUrl({ app: appKey });
  return { appKey, url: data.url, startedAt: data.startedAt };
}

/**
 * Checks whether the app the user was sent to authorize has connected yet.
 * Uses a short internal timeout so a single call can't hang a request for
 * minutes — the caller (the browser) re-calls this every few seconds until
 * it gets a non-null result or the user gives up.
 */
export async function pollZapierConnect(
  appKey: string,
  startedAt: number,
): Promise<ConnectedApp | null> {
  const zapier = getZapierSdk();
  try {
    await zapier.waitForNewConnection({ app: appKey, startedAt, timeoutMs: 4000 });
  } catch {
    return null; // not connected yet this round — caller will poll again
  }
  const all = await getConnections();
  return all.find((c) => c.id === appKey) ?? null;
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

/** Builds the action catalog for a single app. Extraction runs one app at a
 * time (one AI-by-Zapier task per app), so a focused, single-app catalog
 * keeps each prompt small and its matching accurate. */
async function buildActionCatalogForApp(
  zapier: ZapierSdkInstance,
  appKey: string,
): Promise<CatalogEntry[]> {
  let appName = appKey;
  try {
    const { data: app } = await zapier.getApp({ appKey });
    appName = app.title ?? appKey;
  } catch {
    // Fall back to the raw key if app metadata can't be loaded.
  }
  const catalog: CatalogEntry[] = [];
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
  return catalog;
}

/** Prompt scoped to a single app: the model only considers actions from that
 * one app's catalog, so it extracts more precisely than a catch-all prompt
 * spanning every connected app at once. */
function buildAppExtractionPrompt(
  appName: string,
  catalog: CatalogEntry[],
  transcript: string,
): string {
  const catalogForPrompt = catalog.map((c) => ({
    ref: c.ref,
    title: c.title,
    description: c.description,
  }));
  return `You read call and meeting transcripts and propose concrete follow-up actions a rep can run through ${appName}, specifically.

Extract the action item(s) from the transcript that relate to ${appName}. Only propose actions that match an entry from this ${appName} action catalog exactly by "ref" — never invent an action that isn't listed:
${JSON.stringify(catalogForPrompt)}

Rules:
- Only propose actions that genuinely belong to ${appName}. If the transcript implies work for a different app, ignore it here — another pass handles that app.
- Every proposed action must be clearly and specifically grounded in the transcript. Do not invent action items the transcript doesn't support.
- A single transcript can warrant more than one ${appName} action — return all of them.
- "sourceQuote" must be an exact, verbatim, contiguous substring of the transcript — same wording, casing, and punctuation — because it is used to highlight the source phrase. Do not paraphrase, summarize, or trim it.
- "params" should cover the input fields a person would need to fill in to run the action (recipient, subject, body, channel, message, date, etc.), inferred from context. Use "" for a value you can't determine from the transcript.
- When an action targets a specific resource the account owns — a Slack channel, a Trello board or list, a Notion database, an Airtable base, an Asana project, and the like — name that resource explicitly in its param value using the plain name from the transcript (e.g. channel "general" or "xr-marketing", board "Q3 Roadmap"). It will be matched to the account's real resources, so use the actual name if the transcript gives one, and "" if it doesn't — never invent a name.
- "confidence" is a 0-1 score reflecting how clearly the transcript supports the action.
- Don't propose duplicate actions for the same thing.
- It's fine to return zero actions if nothing in the transcript warrants a ${appName} action.

TRANSCRIPT:
"""
${transcript}
"""

Respond with ONLY a JSON object of the exact shape {"actions": [{"ref": "...", "summary": "...", "sourceQuote": "...", "confidence": 0.0, "params": [{"key": "...", "label": "...", "value": "..."}]}]}. No prose, no markdown code fences, nothing before or after the JSON.`;
}

/** Encodes the Zapier routing info needed to later execute this action into
 * the opaque `id` field, since ProposedAction has no field for it. The
 * connectionId is baked in so execution runs against the exact account the
 * user chose — never a re-guessed connection. */
function encodeActionId(
  entry: Pick<CatalogEntry, "appKey" | "actionType" | "actionKey">,
  connectionId: string,
): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return [entry.appKey, entry.actionType, entry.actionKey, connectionId, suffix]
    .map(encodeURIComponent)
    .join("|");
}

function decodeActionId(
  id: string,
): { appKey: string; actionType: string; actionKey: string; connectionId: string } | null {
  const parts = id.split("|");
  // [appKey, actionType, actionKey, connectionId, suffix]
  if (parts.length < 4) return null;
  const [appKey, actionType, actionKey, connectionId] = parts.map(decodeURIComponent);
  return { appKey, actionType, actionKey, connectionId };
}

/* ── Dynamic resource resolution (Slack channels, Trello boards, etc.) ── */

/** Normalizes a resource name for fuzzy comparison: lowercases and collapses
 * separators (#, @, _, -, whitespace) so "#Xr_Marketing" == "xr marketing". */
function normalizeResourceName(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[#@_\-\s]+/g, " ")
    .trim();
}

/**
 * Matches the AI's free-text target ("general", "#xr-marketing", "the shared
 * channel") to a real option's `value` (the id the app expects). Deliberately
 * CONSERVATIVE: only exact key/label or full-phrase containment counts. Anything
 * vaguer returns null so the caller leaves the field blank + required rather
 * than sending to the wrong channel/board.
 */
function matchResourceChoice(guess: string, choices: ParamChoice[]): string | null {
  const g = normalizeResourceName(guess);
  if (!g) return null;
  // Exact match on the id or the human label.
  const exact = choices.find(
    (c) => normalizeResourceName(c.value) === g || normalizeResourceName(c.label) === g,
  );
  if (exact) return exact.value;
  // Full-phrase containment either direction, for labels long enough to be
  // specific (avoids a 2-char label matching half the transcript).
  const phrase = choices.find((c) => {
    const l = normalizeResourceName(c.label);
    return l.length >= 3 && (g === l || g.includes(l) || l.includes(g));
  });
  return phrase ? phrase.value : null;
}

type FieldSchema = {
  title?: string;
  "zapier:dynamicEnum"?: boolean;
};

/** Fetches the real options for one dynamic field, capped so a huge dropdown
 * can't stall extraction. Returns [] on any error (field stays free-text). */
async function fetchFieldChoices(
  zapier: ZapierSdkInstance,
  appKey: string,
  actionType: ZapierActionType,
  actionKey: string,
  fieldKey: string,
  connectionId: string,
): Promise<ParamChoice[]> {
  const choices: ParamChoice[] = [];
  try {
    for await (const c of zapier
      .listActionInputFieldChoices({
        appKey,
        actionType,
        actionKey,
        inputFieldKey: fieldKey,
        connection: connectionId,
        maxItems: 500,
      })
      .items()) {
      if (c.key == null) continue;
      choices.push({ value: String(c.key), label: String(c.label ?? c.key) });
    }
  } catch {
    // Choices unavailable — the field falls back to free text.
    return [];
  }
  return choices;
}

/**
 * Runs the full extraction pipeline for a SINGLE app: build that app's action
 * catalog, run one AI-by-Zapier prompt (one task, on the free model), then
 * validate every proposal (real catalog ref + verbatim transcript quote +
 * runnable input schema). Returns the app's validated actions.
 *
 * `connectionId` is the caller-resolved connection for this app; passing it in
 * avoids re-resolving the whole connection map once per app.
 */
async function extractActionsForApp(
  zapier: ZapierSdkInstance,
  appKey: string,
  connectionId: string,
  accountLabel: string,
  transcript: string,
): Promise<ProposedAction[]> {
  const catalog = await buildActionCatalogForApp(zapier, appKey);
  if (catalog.length === 0) return [];
  const catalogByRef = new Map(catalog.map((c) => [c.ref, c]));
  const appName = catalog[0].appName;

  const rawOutput = await runAiByZapierPrompt(
    zapier,
    buildAppExtractionPrompt(appName, catalog, transcript),
  );

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawOutput);
  } catch {
    const match = rawOutput.match(/[[{][\s\S]*[\]}]/);
    if (!match) {
      throw new Error(`AI by Zapier did not return parseable JSON: ${rawOutput.slice(0, 200)}`);
    }
    parsedJson = JSON.parse(match[0]);
  }

  const extraction = ExtractionSchema.safeParse(parsedJson);
  if (!extraction.success) {
    throw new Error(
      `AI by Zapier's response didn't match the expected shape: ${extraction.error.message}`,
    );
  }

  const validated: ProposedAction[] = [];

  for (const proposal of extraction.data.actions) {
    const entry = catalogByRef.get(proposal.ref);
    if (!entry) continue; // not a real catalog action for this app — drop
    if (!transcript.includes(proposal.sourceQuote)) continue; // quote must be real — drop

    let requiredKeys: string[] = [];
    let fieldLabels: Record<string, string> = {};
    let dynamicKeys: string[] = [];
    try {
      const inputs = Object.fromEntries(proposal.params.map((p) => [p.key, p.value]));
      const { data: schema } = await zapier.getActionInputFieldsSchema({
        appKey: entry.appKey,
        actionType: entry.actionType,
        actionKey: entry.actionKey,
        connection: connectionId,
        inputs,
      });
      const properties = (schema?.properties as Record<string, FieldSchema>) ?? {};
      requiredKeys = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
      fieldLabels = Object.fromEntries(
        Object.entries(properties).map(([key, field]) => [key, field?.title ?? key]),
      );
      // Fields backed by a live account resource (Slack channel, Trello board,
      // Notion database, …) are flagged by Zapier as dynamic enums.
      dynamicKeys = Object.entries(properties)
        .filter(([, field]) => field?.["zapier:dynamicEnum"] === true)
        .map(([key]) => key);
    } catch {
      // Can't validate this action's inputs — drop it rather than
      // proposing something that isn't runnable.
      continue;
    }

    const paramsByKey = new Map(proposal.params.map((p) => [p.key, p]));
    const allKeys = new Set([...paramsByKey.keys(), ...requiredKeys]);

    // Resolve dynamic resource fields against the account's real options: fetch
    // the real {value,label} choices and map the AI's free-text target to a
    // real value. Only resolve dynamic fields the AI actually populated (or
    // required ones) to keep the number of choice lookups small.
    const dynamicToResolve = [...allKeys].filter(
      (key) =>
        dynamicKeys.includes(key) &&
        (paramsByKey.get(key)?.value?.trim() || requiredKeys.includes(key)),
    );
    const choicesByKey = new Map<string, ParamChoice[]>();
    await Promise.all(
      dynamicToResolve.map(async (key) => {
        const choices = await fetchFieldChoices(
          zapier,
          entry.appKey,
          entry.actionType,
          entry.actionKey,
          key,
          connectionId,
        );
        if (choices.length > 0) choicesByKey.set(key, choices);
      }),
    );

    const params: ActionParam[] = [...allKeys].map((key) => {
      const claimed = paramsByKey.get(key);
      const choices = choicesByKey.get(key);
      if (choices) {
        // Dynamic resource field: map the AI's target to a real option, or
        // blank it and force the user to pick if there's no confident match.
        const matched = claimed?.value ? matchResourceChoice(claimed.value, choices) : null;
        return {
          key,
          label: claimed?.label ?? fieldLabels[key] ?? key,
          value: matched ?? "",
          required: requiredKeys.includes(key),
          choices,
          dynamic: true,
        };
      }
      return {
        key,
        label: claimed?.label ?? fieldLabels[key] ?? key,
        value: claimed?.value ?? "",
        required: requiredKeys.includes(key),
      };
    });

    validated.push({
      id: encodeActionId(entry, connectionId),
      appId: entry.appKey,
      appName: entry.appName,
      accountLabel,
      actionType: entry.title,
      summary: proposal.summary,
      params,
      sourceQuote: proposal.sourceQuote,
      confidence: Math.max(0, Math.min(1, proposal.confidence)),
    });
  }

  return validated;
}

/** A user-chosen connection to analyze: a specific account for an app. */
export type AnalysisTarget = {
  appKey: string;
  connectionId: string;
  /** Human app + account label, purely for display (progress + error rows). */
  appName: string;
  accountLabel: string;
};

/** One target's slice of the streamed analysis result. Emitted as soon as that
 * app/account's extraction settles — success or failure — so the UI can render
 * progressively in completion order. Keyed by connectionId (not appId) so the
 * same app analyzed under two accounts stays distinct. */
export type AppAnalysisResult = {
  connectionId: string;
  appId: string;
  appName: string;
  accountLabel: string;
  status: "done" | "error";
  actions: ProposedAction[];
  error?: string;
};

/**
 * Streaming, per-target transcript analysis. Fans out one AI-by-Zapier prompt
 * per chosen connection (one Zapier task each) CONCURRENTLY, and yields each
 * result the moment it finishes — so a caller can render actions progressively
 * in completion order rather than waiting for the slowest one.
 *
 * `targets` is the user's chosen {app, account} pairs. Extraction and the
 * resulting actions are bound to the exact connectionId the user picked, so
 * execution later runs against that account — no re-guessing.
 *
 * Returns an async generator. TanStack Start's server-function transport
 * (seroval) serializes async iterables natively, so the browser receives an
 * async-iterable it can `for await` over as results land.
 */
export async function* analyzeTranscriptStream(input: {
  transcript: string;
  targets: AnalysisTarget[];
}): AsyncGenerator<AppAnalysisResult, void, unknown> {
  const { transcript, targets } = input;
  if (typeof transcript !== "string" || !transcript.trim()) {
    throw new Error("transcript must be a non-empty string");
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("select at least one app and account to analyze");
  }

  const zapier = getZapierSdk();

  // Fan out concurrently: start every target's extraction now, and yield each
  // result as its promise settles (completion order), not request order.
  // Each promise resolves to an AppAnalysisResult tagged with its own index so
  // it can be removed from the pending pool once yielded.
  const pending = new Map<number, Promise<{ index: number; result: AppAnalysisResult }>>();
  targets.forEach((target, index) => {
    const base = {
      connectionId: target.connectionId,
      appId: target.appKey,
      appName: target.appName,
      accountLabel: target.accountLabel,
    };
    pending.set(
      index,
      (async () => {
        try {
          const actions = await extractActionsForApp(
            zapier,
            target.appKey,
            target.connectionId,
            target.accountLabel,
            transcript,
          );
          return { index, result: { ...base, status: "done", actions } as const };
        } catch (error) {
          return {
            index,
            result: {
              ...base,
              status: "error",
              actions: [],
              error: error instanceof Error ? error.message : "Extraction failed for this account.",
            } as const,
          };
        }
      })(),
    );
  });

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    pending.delete(index);
    yield result;
  }
}

/* ─────────────────────── executeActions ─────────────────────── */

export async function executeActions(actions: ProposedAction[]): Promise<ExecutionResult[]> {
  const zapier = getZapierSdk();

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

    // Run against the exact connection the user chose during analysis — baked
    // into the action id — rather than re-guessing a connection for the app.
    try {
      const inputs = Object.fromEntries(action.params.map((p) => [p.key, p.value]));
      await zapier.apps[ref.appKey][ref.actionType][ref.actionKey]({
        connection: ref.connectionId,
        inputs,
      });
      results.push({
        actionId: action.id,
        status: "succeeded",
        message: `${action.actionType} completed via ${action.appName} (${action.accountLabel}).`,
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
}
