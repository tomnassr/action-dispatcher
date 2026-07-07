// TanStack Start adapter over the framework-agnostic core in
// action-dispatcher.ts. This file's only job is wrapping each core function
// in createServerFn so the client bundle never sees @zapier/zapier-sdk or
// any server-only code — the actual logic lives in action-dispatcher.ts and
// has no TanStack dependency at all.

import { createServerFn } from "@tanstack/react-start";
import * as core from "@/lib/action-dispatcher";

export type {
  SdkStatus,
  ConnectedApp,
  ConnectedAccount,
  ActionParam,
  ProposedAction,
  ExecutionResult,
  ZapierAppSummary,
  ZapierConnectStart,
  AppAnalysisResult,
  AnalysisTarget,
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

const getSdkStatusFn = createServerFn({ method: "GET" }).handler(core.getSdkStatus);

/** Whether the Zapier SDK is authenticated (and as whom). Drives whether the
 * app shows setup instructions or the app UI. */
export async function getSdkStatus(): Promise<core.SdkStatus> {
  return getSdkStatusFn();
}

const getConnectionsFn = createServerFn({ method: "GET" }).handler(core.getConnections);

export async function getConnections(): Promise<core.ConnectedApp[]> {
  return getConnectionsFn();
}

const getConnectedAccountsFn = createServerFn({ method: "GET" }).handler(core.getConnectedAccounts);

/** Every authorized connection as its own account — the prioritize page uses
 * this to let the user pick which account each app runs as. */
export async function getConnectedAccounts(): Promise<core.ConnectedAccount[]> {
  return getConnectedAccountsFn();
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

const analyzeTranscriptStreamFn = createServerFn({ method: "POST" })
  .validator((input: unknown): { transcript: string; targets: core.AnalysisTarget[] } => {
    const value = input as { transcript?: unknown; targets?: unknown };
    if (typeof value.transcript !== "string" || !value.transcript.trim()) {
      throw new Error("transcript must be a non-empty string");
    }
    if (!Array.isArray(value.targets) || value.targets.length === 0) {
      throw new Error("select at least one app and account to analyze");
    }
    const targets = value.targets.map((t): core.AnalysisTarget => {
      const target = t as Partial<core.AnalysisTarget>;
      if (
        typeof target.appKey !== "string" ||
        typeof target.connectionId !== "string" ||
        !target.appKey ||
        !target.connectionId
      ) {
        throw new Error("each target needs an appKey and connectionId");
      }
      return {
        appKey: target.appKey,
        connectionId: target.connectionId,
        appName: typeof target.appName === "string" ? target.appName : target.appKey,
        accountLabel: typeof target.accountLabel === "string" ? target.accountLabel : target.appKey,
      };
    });
    return { transcript: value.transcript, targets };
  })
  .handler(({ data }) => core.analyzeTranscriptStream(data));

/**
 * Streams per-target analysis results as each app/account's extraction settles.
 * Returns an async iterable the caller consumes with `for await` in completion
 * order — TanStack Start's server-function transport delivers the server-side
 * async generator to the client as an async iterable.
 */
export async function analyzeTranscriptStream(
  transcript: string,
  targets: core.AnalysisTarget[],
): Promise<AsyncIterable<core.AppAnalysisResult>> {
  return analyzeTranscriptStreamFn({ data: { transcript, targets } });
}

const executeActionsFn = createServerFn({ method: "POST" })
  .validator((actions: unknown): core.ProposedAction[] => actions as core.ProposedAction[])
  .handler(({ data }) => core.executeActions(data));

export async function executeActions(
  actions: core.ProposedAction[],
): Promise<core.ExecutionResult[]> {
  return executeActionsFn({ data: actions });
}
