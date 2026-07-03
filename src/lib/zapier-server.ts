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
//   ANTHROPIC_API_KEY         Claude API key (read automatically by the SDK)
//   ZAPIER_CONNECTION_IDS     Optional JSON map of appKey -> connectionId,
//                             e.g. {"gmail":"12345"} — printed by the setup script.

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
