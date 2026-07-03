// Server-only Zapier SDK wiring.
//
// Persistence note: this app builds against Nitro's Cloudflare preset
// (see vite.config.ts and the wrangler entries in .gitignore), which has no
// writable filesystem at runtime and no way to durably set an env var from
// inside a request handler. So connection ids are treated as read-only
// configuration (ZAPIER_CONNECTION_IDS), populated ahead of time by running
// `npm run zapier:connect` locally and copying its output into `.dev.vars`
// (dev) or the host's env/secret store (production) — never written by the
// app itself. When no id is pinned for an app, we fall back to the most
// recently created connection Zapier reports for it.
//
// Required env vars:
//   ZAPIER_CREDENTIALS        Zapier API token (read automatically by the SDK)
//   ZAPIER_CONNECTION_IDS     Optional JSON map of appKey -> connectionId,
//                             e.g. {"gmail":"12345"} — printed by the setup script.
//
// The transcript analysis itself runs through the built-in "AI by Zapier"
// action (native OpenAI/Anthropic/Gemini access) instead of a direct model
// API — no separate AI provider key needed. "AI by Zapier" isn't a fixed,
// hardcoded action: it's discovered at runtime via the same app/action
// catalog every other integration uses, since the SDK has no special case
// for it.

import { createZapierSdk, type ZapierSdk } from "@zapier/zapier-sdk";

export type ZapierSdkInstance = ZapierSdk;
export type ZapierActionType =
  | "read"
  | "read_bulk"
  | "write"
  | "search"
  | "search_or_write"
  | "search_and_write"
  | "filter"
  | "run";

let sdk: ZapierSdk | null = null;

export function getZapierSdk(): ZapierSdk {
  if (!sdk) {
    sdk = createZapierSdk();
  }
  return sdk;
}

export function getPersistedConnectionIds(): Record<string, string | number> {
  const raw = process.env.ZAPIER_CONNECTION_IDS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    console.error("ZAPIER_CONNECTION_IDS is not valid JSON — ignoring it.");
    return {};
  }
}

/** appKey -> connectionId, preferring the pinned id from ZAPIER_CONNECTION_IDS. */
export async function resolveConnectionMap(
  zapier: ZapierSdk,
): Promise<Record<string, string | number>> {
  const map = { ...getPersistedConnectionIds() };
  for await (const conn of zapier.listConnections().items()) {
    if (conn.app_key && map[conn.app_key] === undefined) {
      map[conn.app_key] = conn.id;
    }
  }
  return map;
}

/* ─────────────────────── AI by Zapier ─────────────────────── */

type AiByZapierAction = {
  appKey: string;
  actionType: ZapierActionType;
  actionKey: string;
  promptFieldKey: string;
  needsConnection: boolean;
};

let aiAction: Promise<AiByZapierAction> | null = null;

async function discoverAiByZapierAction(zapier: ZapierSdk): Promise<AiByZapierAction> {
  const { data: apps } = await zapier.listApps({ search: "AI by Zapier", maxItems: 10 });
  const app =
    apps.find((a) => a.title?.toLowerCase() === "ai by zapier") ??
    apps.find((a) => a.slug === "ai" || a.key === "ai") ??
    apps[0];
  if (!app) {
    throw new Error(
      'Could not find "AI by Zapier" in this Zapier account\'s app catalog. It ships by default on every plan — check that ZAPIER_CREDENTIALS is set correctly.',
    );
  }
  const appKey = app.slug ?? app.key;

  const actions: { key: string; action_type: ZapierActionType; title: string }[] = [];
  for await (const action of zapier.listActions({ appKey, maxItems: 50 }).items()) {
    actions.push(action);
  }
  const action =
    actions.find((a) => /analyze.*return.*data/i.test(a.title)) ??
    actions.find((a) => a.action_type === "write") ??
    actions[0];
  if (!action) {
    throw new Error('"AI by Zapier" has no usable actions on this account.');
  }

  let promptFieldKey = "prompt";
  try {
    const { data: schema } = await zapier.getActionInputFieldsSchema({
      appKey,
      actionType: action.action_type,
      actionKey: action.key,
    });
    const properties =
      (schema?.properties as Record<string, { title?: string; description?: string }>) ?? {};
    const match = Object.entries(properties).find(([key, field]) => {
      const haystack = `${key} ${field?.title ?? ""} ${field?.description ?? ""}`.toLowerCase();
      return haystack.includes("prompt") || haystack.includes("instructions");
    });
    if (match) promptFieldKey = match[0];
  } catch {
    // Fall back to the conventional "prompt" key below.
  }

  return {
    appKey,
    actionType: action.action_type,
    actionKey: action.key,
    promptFieldKey,
    needsConnection: Boolean(app.auth_type),
  };
}

function getAiByZapierAction(zapier: ZapierSdk): Promise<AiByZapierAction> {
  if (!aiAction) {
    aiAction = discoverAiByZapierAction(zapier).catch((error: unknown) => {
      aiAction = null; // let the next call retry instead of caching a failure
      throw error;
    });
  }
  return aiAction;
}

/** Runs a single freeform prompt through "AI by Zapier" and returns its raw text output. */
export async function runAiByZapierPrompt(zapier: ZapierSdk, prompt: string): Promise<string> {
  const action = await getAiByZapierAction(zapier);

  let connection: string | number | undefined;
  if (action.needsConnection) {
    const map = await resolveConnectionMap(zapier);
    connection = map[action.appKey];
    if (connection === undefined) {
      throw new Error(
        `"AI by Zapier" needs a connection but none is configured. Run "npm run zapier:connect ${action.appKey}".`,
      );
    }
  }

  const result = await zapier.apps[action.appKey][action.actionType][action.actionKey]({
    connection,
    inputs: { [action.promptFieldKey]: prompt },
  });

  const record = (result.data?.[0] ?? {}) as Record<string, unknown>;
  const values = Object.values(record).filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  const jsonLike = values.find((v) => /^\s*[[{]/.test(v));
  const text = jsonLike ?? [...values].sort((a, b) => b.length - a.length)[0];
  if (!text) {
    throw new Error('"AI by Zapier" returned no text output to parse.');
  }
  return text;
}
