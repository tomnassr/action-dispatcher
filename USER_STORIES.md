# User Stories

Action Dispatcher turns a call/meeting transcript into a reviewable queue of
actions across whatever apps a user has connected in Zapier — nothing about
the app assumes a fixed roster of integrations. These stories describe the
product from the perspective of a single user (a sales rep, founder, or
support lead) connecting their own Zapier account.

## Connecting apps

- **As a new user**, I want to connect Zapier with my own account credentials,
  so that the app acts on my apps, not a demo account.
- **As a user with an existing Zapier account**, I want the app to recognize
  whichever apps I've already connected — Gmail, Notion, Trello, Mailchimp,
  or anything else in Zapier's catalog — so that I'm not limited to a
  hardcoded set of "supported" integrations.
- **As a user**, I want to see which apps are connected, along with how many
  actions each one exposes, so that I know what the assistant can actually do
  before I paste a transcript.
- **As a user**, I want AI-powered extraction to work without setting up a
  separate OpenAI/Anthropic account or API key, so that connecting Zapier is
  the only credential I need to manage.

## Analyzing a transcript

- **As a user**, I want to paste in a raw call or meeting transcript and get
  back a list of concrete follow-up actions, so that I don't have to manually
  re-read it looking for commitments I made.
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

## Reviewing the queue

- **As a user**, I want to see the source transcript and the proposed actions
  side by side, with hovering an action highlighting its source quote, so
  that I can quickly cross-check each one in context.
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
- **As a user**, I want a clear success/failure result for each action I ran,
  with an explanation when something fails, so that I know what actually
  happened and what (if anything) I need to redo manually.
- **As a user**, I want to start over with a new transcript after a run
  completes, so that I can process my next call without restarting the app.

## Operating the app

- **As the person deploying this**, I want to connect new apps at any time by
  running a single setup command, so that adding a new integration doesn't
  require a code change.
- **As the person deploying this**, I want the app to keep working correctly
  if I connect a completely different set of apps than the demo used, so
  that this is a general-purpose tool, not a demo hardcoded to four
  integrations.
- **As the person deploying this**, I want the app to tell me clearly when
  something is misconfigured (no connections, a bad Zapier token, an
  unreachable AI action) rather than failing silently, so that I can fix
  setup issues without digging through code.
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
