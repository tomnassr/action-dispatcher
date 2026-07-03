# Action Dispatcher

Paste a call/meeting transcript in, get a reviewable queue of concrete actions
out — pre-filled emails, calendar invites, Slack posts, CRM records — matched
against whatever apps you've actually connected in Zapier. You check off what
you want to run; nothing fires automatically.

Built for [ZapConnect 2026](https://sp-submissions-zapconnect-26.zapier.app/page).

**No AI provider key required.** Transcript analysis runs through
[AI by Zapier](https://zapier.com/apps/ai/integrations), Zapier's built-in AI
action — the only credential this app needs is your Zapier account.

See [USER_STORIES.md](./USER_STORIES.md) for the product spec this was built
against.

## How it works

```
transcript ──▶ analyzeTranscript() ──▶ review queue ──▶ executeActions()
                     │                                        │
                     ├─ zapier.listActions()  (catalog scoped │
                     │  to your connected apps)                │
                     ├─ AI by Zapier            (extracts       │
                     │  candidate actions as JSON)              │
                     └─ zapier.getActionInputFieldsSchema()     │
                        (drops/flags anything missing            │
                        a required input)                        │
                                                                   ▼
                                                    zapier.apps[app][type][action]()
```

Three functions are the entire backend contract:

| Function | What it does |
| --- | --- |
| `getConnections()` | Lists your live Zapier connections, enriched with app metadata (category, action count). |
| `analyzeTranscript(transcript)` | Scopes the Zapier action catalog to your connected apps, asks AI by Zapier to match transcript phrases to catalog actions, verifies every quote is real and every required input is present, and returns the validated list. |
| `executeActions(actions)` | Runs only the actions you pass in — one Zapier action call each — and returns a success/failure result per action. Nothing runs unless you explicitly pass it here. |

## Quickstart

**1. Clone and install**

```sh
git clone https://github.com/tomnassr/action-dispatcher.git
cd action-dispatcher
npm install   # or: bun install
```

**2. Get a Zapier API token**

For local dev, the easiest path is:

```sh
npx zapier-sdk login
```

This opens a browser, authorizes, and stores a token at
`~/.zapier-sdk/config.json` that the SDK reads automatically — no env var
needed locally. For CI/production, set `ZAPIER_CREDENTIALS` explicitly (see
`.dev.vars.example`).

**3. Connect the apps you want to use**

```sh
npm run zapier:connect gmail slack hubspot google-calendar
```

Replace those with whatever apps you actually want — the app is not
hardcoded to any specific set. This opens a Zapier-hosted authorization URL
per app and, once you approve it, prints:

```
ZAPIER_CONNECTION_IDS='{"gmail":"...","slack":"..."}'
```

Copy that into `.dev.vars` (copy `.dev.vars.example` as a starting point).
AI by Zapier itself needs no separate connection step — it's available on
every Zapier account by default.

**4. Run it**

```sh
npm run dev
```

## Embedding this logic in your own app

The reusable component is two files, and neither imports TanStack Start,
React, or anything else specific to this demo:

- **`src/lib/zapier-server.ts`** — the Zapier SDK singleton, connection
  persistence (`ZAPIER_CONNECTION_IDS`), and AI by Zapier discovery
  (`runAiByZapierPrompt`). This app never hardcodes an app/action key for AI
  by Zapier — it's found at runtime via `zapier.listApps()` /
  `zapier.listActions()`, the same catalog lookup used for every other
  integration.
- **`src/lib/action-dispatcher.ts`** — `getConnections()`,
  `analyzeTranscript(transcript)`, and `executeActions(actions)` as plain
  `async` functions, plus the shared types (`ConnectedApp`, `ProposedAction`,
  `ActionParam`, `ExecutionResult`). Each call reads `ZAPIER_CREDENTIALS` /
  `ZAPIER_CONNECTION_IDS` from `process.env` at call time — nothing is baked
  in at build time, so whoever's environment it runs in is whose Zapier
  account it uses.

**To embed this in another backend:** copy both files into your project,
`npm install @zapier/zapier-sdk zod`, and call the three functions directly —
there's no framework wrapper to strip out. For example, in a plain Express
route:

```ts
import { analyzeTranscript } from "./action-dispatcher";

app.post("/analyze", async (req, res) => {
  res.json(await analyzeTranscript(req.body.transcript));
});
```

`src/lib/zapier-dispatch.ts` is the one framework-specific file — a ~50-line
adapter that wraps each `action-dispatcher.ts` function in TanStack Start's
`createServerFn(...)` so it can be called from client components without
shipping `@zapier/zapier-sdk` to the browser. If you're not using TanStack
Start, you don't need this file at all.

## A note on persistence

This app targets Nitro's Cloudflare Workers preset, which has no writable
filesystem and no way to durably set an env var from inside a request
handler. `ZAPIER_CONNECTION_IDS` is treated as read-only configuration,
populated ahead of time by `npm run zapier:connect` — the app never tries to
write it. If you deploy elsewhere with a real filesystem or a KV/database
available, you could persist connection ids there instead; the current
design intentionally avoids assuming that's available.

## Tech stack

TanStack Start (Vite + Nitro + TanStack Router) · React 19 · Tailwind v4 ·
[`@zapier/zapier-sdk`](https://www.npmjs.com/package/@zapier/zapier-sdk) ·
Zod

## License

MIT — see [LICENSE](./LICENSE). Use this however you like, including as a
starting point for your own Zapier-connected app.
