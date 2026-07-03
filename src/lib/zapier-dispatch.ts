// POC mock — no real Zapier calls. Same exported surface as before so
// index.tsx doesn't need to change. Swap the bodies for the real
// action-dispatcher.ts server functions when wiring the real backend.

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
  actionType: string;
  summary: string;
  params: ActionParam[];
  sourceQuote: string;
  confidence: number;
};

export type ExecutionResult = {
  actionId: string;
  status: "succeeded" | "failed";
  message: string;
  ranAt: string;
};

export const SAMPLE_TRANSCRIPT_TEXT = `[00:02] Jamie (Acme): Thanks for jumping on, Priya. Quick recap — we've been evaluating three vendors for the Q3 migration and honestly, your platform is the front-runner.
[00:41] Priya (us): Appreciate that. What's the decision timeline looking like?
[01:03] Jamie: Legal review kicks off Monday. If we can get the redlined MSA back to me by Thursday, we're on track to sign end of month.
[01:29] Priya: I'll get the MSA over to you today with our standard redlines. I'll also loop in our solutions engineer, Marcus, on the technical scoping call.
[02:14] Jamie: Perfect. Can you send a calendar invite for the technical deep-dive? Tuesday 2pm ET works for me and my head of infra, David Chen — david.chen@acme.co.
[02:47] Priya: Done. I'll also drop a note in our shared Slack channel so the wider account team is aware we're moving to procurement.
[03:12] Jamie: One more thing — add me to your customer newsletter list. And it'd be great if someone from your CS team could reach out to my colleague Sarah Reyes at sarah@acme.co, she's leading a parallel eval for our EMEA org.
[03:44] Priya: All noted. Talk Thursday.`;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getConnections(): Promise<ConnectedApp[]> {
  await delay(400);
  return [
    { id: "gmail", name: "Gmail", category: "Email", actionCount: 14, connectedAt: "2026-06-12T10:24:00Z" },
    { id: "slack", name: "Slack", category: "Team Chat", actionCount: 22, connectedAt: "2026-06-12T10:24:12Z" },
    { id: "hubspot", name: "HubSpot", category: "CRM", actionCount: 31, connectedAt: "2026-06-14T09:02:00Z" },
    { id: "gcal", name: "Google Calendar", category: "Calendar", actionCount: 9, connectedAt: "2026-06-14T09:03:11Z" },
    { id: "mailchimp", name: "Mailchimp", category: "Marketing", actionCount: 12, connectedAt: "2026-06-18T14:41:00Z" },
  ];
}

export async function analyzeTranscript(_transcript: string): Promise<ProposedAction[]> {
  await delay(1200);
  return [
    {
      id: "a1",
      appId: "gmail",
      appName: "Gmail",
      actionType: "Send Email",
      summary: "Send the redlined MSA to Jamie for legal review.",
      sourceQuote: "I'll get the MSA over to you today with our standard redlines.",
      confidence: 0.94,
      params: [
        { key: "to", label: "To", value: "jamie@acme.co", required: true },
        { key: "subject", label: "Subject", value: "Redlined MSA — Acme × Us", required: true },
        { key: "body", label: "Body", value: "Hi Jamie,\n\nAttached is the redlined MSA with our standard edits. Let me know if legal has questions.\n\nPriya", required: true, multiline: true },
      ],
    },
    {
      id: "a2",
      appId: "gcal",
      appName: "Google Calendar",
      actionType: "Create Event",
      summary: "Schedule the technical deep-dive with Jamie and David Chen.",
      sourceQuote: "Can you send a calendar invite for the technical deep-dive? Tuesday 2pm ET works for me and my head of infra, David Chen — david.chen@acme.co.",
      confidence: 0.97,
      params: [
        { key: "title", label: "Title", value: "Technical deep-dive — Acme", required: true },
        { key: "start", label: "Start", value: "Tuesday 2:00 PM ET", required: true },
        { key: "attendees", label: "Attendees", value: "jamie@acme.co, david.chen@acme.co, marcus@us.co", required: true },
      ],
    },
    {
      id: "a3",
      appId: "slack",
      appName: "Slack",
      actionType: "Post Message",
      summary: "Notify the account team channel that Acme is moving to procurement.",
      sourceQuote: "I'll also drop a note in our shared Slack channel so the wider account team is aware we're moving to procurement.",
      confidence: 0.88,
      params: [
        { key: "channel", label: "Channel", value: "#acme-account", required: true },
        { key: "message", label: "Message", value: "Acme is moving to procurement — targeting signature end of month. Deep-dive Tuesday 2pm ET.", required: true, multiline: true },
      ],
    },
    {
      id: "a4",
      appId: "hubspot",
      appName: "HubSpot",
      actionType: "Create Contact",
      summary: "Add Sarah Reyes as a contact for the EMEA parallel eval.",
      sourceQuote: "someone from your CS team could reach out to my colleague Sarah Reyes at sarah@acme.co, she's leading a parallel eval for our EMEA org.",
      confidence: 0.91,
      params: [
        { key: "name", label: "Name", value: "Sarah Reyes", required: true },
        { key: "email", label: "Email", value: "sarah@acme.co", required: true },
        { key: "company", label: "Company", value: "Acme (EMEA)", required: false },
      ],
    },
    {
      id: "a5",
      appId: "hubspot",
      appName: "HubSpot",
      actionType: "Create Task",
      summary: "Follow up Thursday to confirm MSA redlines came back.",
      sourceQuote: "on track to sign end of month",
      confidence: 0.72,
      params: [
        { key: "title", label: "Title", value: "Follow up on Acme MSA redlines", required: true },
        { key: "due", label: "Due", value: "Thursday", required: true },
        { key: "assignee", label: "Assignee", value: "", required: true },
      ],
    },
    {
      id: "a6",
      appId: "mailchimp",
      appName: "Mailchimp",
      actionType: "Add Subscriber",
      summary: "Add Jamie to the customer newsletter list.",
      sourceQuote: "add me to your customer newsletter list",
      confidence: 0.86,
      params: [
        { key: "list", label: "List", value: "Customer Newsletter", required: true },
        { key: "email", label: "Email", value: "jamie@acme.co", required: true },
      ],
    },
  ];
}

export async function executeActions(actions: ProposedAction[]): Promise<ExecutionResult[]> {
  await delay(1000);
  const now = new Date().toISOString();
  return actions.map((a, i) => {
    const fail = i === actions.length - 1 && actions.length > 3;
    return {
      actionId: a.id,
      status: fail ? "failed" : "succeeded",
      message: fail
        ? "Rate limited by provider — retry in a moment."
        : `Ran ${a.actionType} in ${a.appName}.`,
      ranAt: now,
    };
  });
}
