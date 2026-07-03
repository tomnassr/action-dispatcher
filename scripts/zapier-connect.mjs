#!/usr/bin/env node
// One-time setup: connects an app to Zapier and prints the resulting
// connection id to persist as ZAPIER_CONNECTION_IDS.
//
// This is intentionally NOT part of the deployed app. The app builds against
// Nitro's Cloudflare preset, which has no writable filesystem at runtime and
// no way to durably set an env var from inside a request handler — so the
// OAuth handshake and any resulting persistence has to happen out-of-band,
// here, in an environment that has a real filesystem and can print output
// for a human to copy.
//
// Usage:
//   ZAPIER_CREDENTIALS=... node scripts/zapier-connect.mjs gmail slack hubspot google-calendar
//
// Then paste the printed ZAPIER_CONNECTION_IDS value into `.dev.vars` for
// local dev, and into your host's env var / secret store for production.

import { createZapierSdk } from "@zapier/zapier-sdk";

const appKeys = process.argv.slice(2);
if (appKeys.length === 0) {
  console.error("Usage: node scripts/zapier-connect.mjs <appKey> [<appKey> ...]");
  console.error("Example: node scripts/zapier-connect.mjs gmail slack hubspot google-calendar");
  process.exit(1);
}

const zapier = createZapierSdk();

let existing = {};
if (process.env.ZAPIER_CONNECTION_IDS) {
  try {
    existing = JSON.parse(process.env.ZAPIER_CONNECTION_IDS);
  } catch {
    console.warn("Existing ZAPIER_CONNECTION_IDS is not valid JSON — starting fresh.");
  }
}

const connectionIds = { ...existing };

for (const appKey of appKeys) {
  console.log(`\n— Connecting ${appKey} —`);
  const { data: start } = await zapier.getConnectionStartUrl({ app: appKey });
  console.log(`Open this URL and authorize the connection:\n  ${start.url}`);
  console.log("Waiting for you to finish authorizing…");

  const { data: connection } = await zapier.waitForNewConnection({
    app: appKey,
    startedAt: start.startedAt,
    timeoutMs: 5 * 60 * 1000,
  });

  connectionIds[appKey] = connection.id;
  console.log(`Connected ${appKey} — connection id ${connection.id}`);
}

console.log("\nAll done. Persist this value in your environment:\n");
console.log(`ZAPIER_CONNECTION_IDS='${JSON.stringify(connectionIds)}'`);
console.log(
  "\nLocally: add that line to .dev.vars. In production: set it as an env var / secret\n" +
    "on your host (this script does not — and on the deployed target, can not — write it for you).",
);
