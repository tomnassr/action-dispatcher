// TanStack Start adapter over the framework-agnostic core in
// action-dispatcher.ts. This file's only job is wrapping each core function
// in createServerFn so the client bundle never sees @zapier/zapier-sdk or
// any server-only code — the actual logic lives in action-dispatcher.ts and
// has no TanStack dependency at all.

import { createServerFn } from "@tanstack/react-start";
import * as core from "@/lib/action-dispatcher";

export type {
  ConnectedApp,
  ActionParam,
  ProposedAction,
  ExecutionResult,
  ZapierAppSummary,
  ZapierConnectStart,
} from "@/lib/action-dispatcher";

const SAMPLE_TRANSCRIPT = `[00:02] Jamie (Acme): Thanks for jumping on, Priya. Quick recap — we've been evaluating three vendors for the Q3 migration and honestly, your platform is the front-runner.
[00:41] Priya (us): Appreciate that. What's the decision timeline looking like?
[01:03] Jamie: Legal review kicks off Monday. If we can get the redlined MSA back to me by Thursday, we're on track to sign end of month.
[01:29] Priya: I'll get the MSA over to you today with our standard redlines. I'll also loop in our solutions engineer, Marcus, on the technical scoping call.
[02:14] Jamie: Perfect. Can you send a calendar invite for the technical deep-dive? Tuesday 2pm ET works for me and my head of infra, David Chen — david.chen@acme.co.
[02:47] Priya: Done. I'll also drop a note in our shared Slack channel so the wider account team is aware we're moving to procurement.
[03:12] Jamie: One more thing — add me to your customer newsletter list. And it'd be great if someone from your CS team could reach out to my colleague Sarah Reyes at sarah@acme.co, she's leading a parallel eval for our EMEA org.
[03:44] Priya: All noted. Talk Thursday.`;

export const SAMPLE_TRANSCRIPT_TEXT = SAMPLE_TRANSCRIPT;

const getConnectionsFn = createServerFn({ method: "GET" }).handler(core.getConnections);

export async function getConnections(): Promise<core.ConnectedApp[]> {
  return getConnectionsFn();
}

const searchZapierAppsFn = createServerFn({ method: "POST" })
  .validator((query: unknown): string => (typeof query === "string" ? query : ""))
  .handler(({ data }) => core.searchZapierApps(data));

export async function searchZapierApps(query: string): Promise<core.ZapierAppSummary[]> {
  return searchZapierAppsFn({ data: query });
}

const startZapierConnectFn = createServerFn({ method: "POST" })
  .validator((appKey: unknown): string => {
    if (typeof appKey !== "string" || !appKey) {
      throw new Error("appKey is required");
    }
    return appKey;
  })
  .handler(({ data }) => core.startZapierConnect(data));

export async function startZapierConnect(appKey: string): Promise<core.ZapierConnectStart> {
  return startZapierConnectFn({ data: appKey });
}

const pollZapierConnectFn = createServerFn({ method: "POST" })
  .validator((input: unknown): { appKey: string; startedAt: number } => {
    const value = input as { appKey?: unknown; startedAt?: unknown };
    if (typeof value.appKey !== "string" || typeof value.startedAt !== "number") {
      throw new Error("appKey and startedAt are required");
    }
    return { appKey: value.appKey, startedAt: value.startedAt };
  })
  .handler(({ data }) => core.pollZapierConnect(data.appKey, data.startedAt));

export async function pollZapierConnect(
  appKey: string,
  startedAt: number,
): Promise<core.ConnectedApp | null> {
  return pollZapierConnectFn({ data: { appKey, startedAt } });
}

const analyzeTranscriptFn = createServerFn({ method: "POST" })
  .validator((transcript: unknown): string => {
    if (typeof transcript !== "string" || !transcript.trim()) {
      throw new Error("transcript must be a non-empty string");
    }
    return transcript;
  })
  .handler(({ data }) => core.analyzeTranscript(data));

export async function analyzeTranscript(transcript: string): Promise<core.ProposedAction[]> {
  return analyzeTranscriptFn({ data: transcript });
}

const executeActionsFn = createServerFn({ method: "POST" })
  .validator((actions: unknown): core.ProposedAction[] => actions as core.ProposedAction[])
  .handler(({ data }) => core.executeActions(data));

export async function executeActions(
  actions: core.ProposedAction[],
): Promise<core.ExecutionResult[]> {
  return executeActionsFn({ data: actions });
}
