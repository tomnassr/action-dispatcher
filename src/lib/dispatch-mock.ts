// Isolated mock data layer.
// Swap these two functions for real API calls later — signatures stay the same.

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

const CONNECTIONS: ConnectedApp[] = [
  { id: "gmail", name: "Gmail", category: "Email", actionCount: 12, connectedAt: "2026-06-14" },
  { id: "slack", name: "Slack", category: "Messaging", actionCount: 8, connectedAt: "2026-06-14" },
  { id: "hubspot", name: "HubSpot", category: "CRM", actionCount: 21, connectedAt: "2026-06-20" },
  { id: "gcal", name: "Google Calendar", category: "Scheduling", actionCount: 6, connectedAt: "2026-06-14" },
];

// Canned proposed actions keyed to substrings of the sample transcript so we
// can highlight the source phrase on hover.
const PROPOSED_ACTIONS: ProposedAction[] = [
  {
    id: "a1",
    appId: "gmail",
    appName: "Gmail",
    actionType: "Send Email",
    summary: "Send the redlined MSA to Jamie at Acme.",
    sourceQuote: "get the redlined MSA back to me by Thursday",
    confidence: 0.94,
    params: [
      { key: "to", label: "To", value: "jamie@acme.co", required: true },
      { key: "subject", label: "Subject", value: "Acme × [Us] — Redlined MSA for review", required: true },
      {
        key: "body",
        label: "Body",
        value: "Hi Jamie,\n\nAttached is our redlined MSA per this morning's call. Flagging Section 7 (data residency) as our primary revision.\n\nHappy to jump on a short call if helpful.\n\n— Priya",
        required: true,
        multiline: true,
      },
      { key: "attachment", label: "Attachment", value: "MSA_Acme_redlined.pdf", required: true },
    ],
  },
  {
    id: "a2",
    appId: "gcal",
    appName: "Google Calendar",
    actionType: "Create Event",
    summary: "Book the technical deep-dive with Jamie and David Chen.",
    sourceQuote: "calendar invite for the technical deep-dive? Tuesday 2pm ET",
    confidence: 0.97,
    params: [
      { key: "title", label: "Title", value: "Technical Deep-Dive — Acme × [Us]", required: true },
      { key: "start", label: "Start", value: "Tue, Jul 7 2026 · 2:00 PM ET", required: true },
      { key: "duration", label: "Duration", value: "60 min", required: true },
      { key: "attendees", label: "Attendees", value: "jamie@acme.co, david.chen@acme.co, marcus@[us].com", required: true },
    ],
  },
  {
    id: "a3",
    appId: "slack",
    appName: "Slack",
    actionType: "Post Message",
    summary: "Post a status update in the Acme account channel.",
    sourceQuote: "drop a note in our shared Slack channel so the wider account team is aware",
    confidence: 0.89,
    params: [
      { key: "channel", label: "Channel", value: "#acct-acme", required: true },
      {
        key: "message",
        label: "Message",
        value: "📌 Acme moving to procurement. Legal review starts Mon, target signature end of month. Tech deep-dive booked for Tue 2pm ET.",
        required: true,
        multiline: true,
      },
    ],
  },
  {
    id: "a4",
    appId: "hubspot",
    appName: "HubSpot",
    actionType: "Create Contact",
    summary: "Add David Chen (Head of Infra, Acme) as a new contact.",
    sourceQuote: "my head of infra, David Chen — david.chen@acme.co",
    confidence: 0.92,
    params: [
      { key: "firstName", label: "First name", value: "David", required: true },
      { key: "lastName", label: "Last name", value: "Chen", required: true },
      { key: "email", label: "Email", value: "david.chen@acme.co", required: true },
      { key: "title", label: "Title", value: "Head of Infrastructure", required: false },
      { key: "company", label: "Company", value: "Acme", required: true },
    ],
  },
  {
    id: "a5",
    appId: "hubspot",
    appName: "HubSpot",
    actionType: "Create Task",
    summary: "Ask CS to reach out to Sarah Reyes about the EMEA evaluation.",
    sourceQuote: "someone from your CS team could reach out to my colleague Sarah Reyes at sarah@acme.co",
    confidence: 0.81,
    params: [
      { key: "assignee", label: "Assignee", value: "", required: true }, // deliberately missing
      { key: "title", label: "Task", value: "Intro call with Sarah Reyes (Acme EMEA)", required: true },
      { key: "contact", label: "Related contact", value: "sarah@acme.co", required: true },
      { key: "dueDate", label: "Due", value: "Within 3 business days", required: false },
    ],
  },
  {
    id: "a6",
    appId: "gmail",
    appName: "Gmail",
    actionType: "Add to List",
    summary: "Add Jamie to the customer newsletter list.",
    sourceQuote: "add me to your customer newsletter list",
    confidence: 0.86,
    params: [
      { key: "list", label: "List", value: "Customer Newsletter — Monthly", required: true },
      { key: "email", label: "Email", value: "jamie@acme.co", required: true },
    ],
  },
];

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** MOCK: replace with real Zapier connections API call. */
export async function getConnections(): Promise<ConnectedApp[]> {
  await delay(600);
  return CONNECTIONS;
}

/** MOCK: replace with real transcript → actions extraction call. */
export async function analyzeTranscript(_transcript: string): Promise<ProposedAction[]> {
  await delay(1800);
  // Deep-clone so component-level edits don't mutate the mock.
  return PROPOSED_ACTIONS.map((a) => ({
    ...a,
    params: a.params.map((p) => ({ ...p })),
  }));
}

export type ExecutionResult = {
  actionId: string;
  status: "succeeded" | "failed";
  message: string;
  ranAt: string;
};

/** MOCK: simulate firing the queued actions. One deterministic failure for demo. */
export async function executeActions(actions: ProposedAction[]): Promise<ExecutionResult[]> {
  await delay(1400);
  return actions.map((a, i) => {
    const fail = a.id === "a3" && i >= 0 && Math.random() < 0.4; // occasional slack fail
    return {
      actionId: a.id,
      status: fail ? "failed" : "succeeded",
      message: fail
        ? "Channel #acct-acme not found — check the channel name and retry."
        : `${a.actionType} completed via ${a.appName}.`,
      ranAt: new Date().toISOString(),
    };
  });
}
