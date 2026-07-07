# User Stories

Action Dispatcher turns a call/meeting transcript into a reviewable queue of
actions across whatever apps a user has connected in Zapier — nothing about
the app assumes a fixed roster of integrations. These stories describe the
product from the perspective of a single user (a sales rep, founder, or
support lead) operating against their own Zapier account.

## Connecting the Zapier SDK

- **As a new user**, I want the app to authenticate against my own Zapier
  account through the Zapier SDK, so that it acts on my apps, not a demo
  account.
- **As a new user who isn't connected yet**, I want the app to detect that the
  SDK isn't authenticated and show me the exact setup steps — clone the repo,
  log in with `npx zapier-sdk login`, run the app — with copyable commands, so
  that I can get connected without digging through docs or code.
- **As a user**, I want the top bar to clearly show whether the SDK is
  connected and, when it is, which Zapier account email I'm authenticated as,
  so that I always know whose apps the assistant is about to act on.
- **As a user with an existing Zapier account**, I want the app to recognize
  whichever apps I've already connected — Gmail, Notion, Trello, Mailchimp,
  or anything else in Zapier's catalog — so that I'm not limited to a
  hardcoded set of "supported" integrations.
- **As a user**, I want AI-powered extraction to work without setting up a
  separate OpenAI/Anthropic account or API key — running on a free,
  plan-included model through AI by Zapier — so that connecting the Zapier
  SDK is the only credential I need to manage.

## Prioritizing apps and accounts

- **As a user**, I want to see all my connected apps in one alphabetical list,
  each showing its category and how many actions it exposes, so that I can
  quickly find the ones relevant to a given transcript.
- **As a user**, I want to prioritize only the apps relevant to this
  transcript before analyzing, so that extraction stays focused and accurate
  instead of considering every app I've ever connected.
- **As a user who has connected the same app under several accounts** (e.g.
  multiple Gmail logins or Slack workspaces), I want to choose which specific
  account each app runs as, so that actions fire from the right identity
  rather than an arbitrarily guessed connection.
- **As a user**, I want to see how many Zapier tasks an analysis will consume
  before I run it (one task per prioritized app), so that I understand the
  cost of a run up front.

## Analyzing a transcript

- **As a user**, I want to paste in a raw call or meeting transcript and get
  back a list of concrete follow-up actions, so that I don't have to manually
  re-read it looking for commitments I made.
- **As a user**, I want each prioritized app analyzed on its own focused pass,
  so that the assistant matches phrasing to that app's actions precisely
  instead of blurring everything into one giant prompt.
- **As a user**, I want proposed actions to stream in as each app finishes
  rather than waiting for the whole batch, so that I can start reviewing the
  fastest results while slower apps are still being analyzed.
- **As a user**, I want each proposed action scoped only to apps and actions
  I've actually connected, so that I'm never shown something I have no way to
  run.
- **As a user**, I want every proposed action tied back to the exact line in
  the transcript that justified it, so that I can verify the AI didn't
  hallucinate a commitment nobody made.
- **As a user**, I want a confidence score on each proposed action, so that I
  can prioritize reviewing the ones the assistant is least sure about.
- **As a user**, I want the assistant to flag when a required field (like a
  recipient or assignee) is missing rather than silently guessing, so that I
  don't fire off an action with a blank that should have been filled in.

## Targeting the right resource

- **As a user whose action targets a specific resource** — a Slack channel, a
  Trello board or list, a Notion database, an Airtable base, an Asana project —
  I want the assistant to resolve the name I mentioned to a real resource my
  account actually has access to, so that the action doesn't fail with a
  "resource not found" error at run time.
- **As a user**, I want these resource fields presented in review as a dropdown
  of my account's real options, pre-selected to the assistant's best match, so
  that I can confirm or change the exact target with confidence.
- **As a user**, I want the assistant to leave a resource target blank and mark
  it required — rather than guessing — when it can't confidently match what I
  said to a real resource, so that I'm never sent to the wrong channel or board.

## Reviewing the queue

- **As a user**, I want to see the source transcript and the proposed actions
  side by side, with hovering an action highlighting its source quote, so
  that I can quickly cross-check each one in context.
- **As a user**, I want each action to show which account it will run as, so
  that I can confirm the right identity before firing it.
- **As a user**, I want to edit any pre-filled field before running an
  action, so that I can correct or complete anything the assistant got wrong
  or left blank.
- **As a user**, I want to individually check or uncheck which actions run,
  so that reviewing the queue is not all-or-nothing.
- **As a user**, I want to be blocked from running an action that's still
  missing a required field, so that I can't accidentally fire something
  incomplete.

## Running actions

- **As a user**, I want nothing to run automatically — only the actions I've
  explicitly checked off — so that the assistant never takes action on my
  behalf without my review.
- **As a user**, I want each action to run against the exact account I chose
  during prioritization, so that execution is never a re-guess of which
  connection to use.
- **As a user**, I want a clear success/failure result for each action I ran,
  with an explanation when something fails, so that I know what actually
  happened and what (if anything) I need to redo manually.
- **As a user**, I want to start over with a new transcript after a run
  completes, so that I can process my next call without restarting the app.

## Operating the app

- **As the person deploying this**, I want to connect new apps at any time by
  authorizing them in Zapier, so that adding a new integration doesn't require
  a code change.
- **As the person deploying this**, I want the app to keep working correctly
  if I connect a completely different set of apps than the demo used, so
  that this is a general-purpose tool, not a demo hardcoded to a few
  integrations.
- **As the person deploying this**, I want to override the AI model via a
  single environment variable (`ZAPIER_AI_MODEL`) without touching code, so
  that I can trade cost for capability when I need to.
- **As the person deploying this**, I want the app to tell me clearly when
  something is misconfigured (SDK not authenticated, no connections, a bad
  Zapier token, an unreachable AI action) rather than failing silently, so
  that I can fix setup issues without digging through code.
- **As a developer**, I want the Zapier/AI integration logic to have zero
  dependency on this app's UI framework, so that I can lift it into a
  different backend (Express, Next.js, a plain Cloudflare Worker) without
  rewriting it.

## Out of scope (for now)

- Multi-user support / per-user auth — this is a single-account tool by
  design.
- Editing or re-running a past batch of results after leaving the "executed"
  screen.
- Persisting analysis history across sessions.
- In-browser OAuth to authorize new apps — authorization happens out of band
  via the Zapier SDK CLI, not inside the app.
