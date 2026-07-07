import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeTranscriptStream,
  executeActions,
  getConnectedAccounts,
  getConnections,
  getSdkStatus,
  SAMPLE_TRANSCRIPT_TEXT,
  type AnalysisTarget,
  type AppAnalysisResult,
  type ConnectedAccount,
  type ConnectedApp,
  type ExecutionResult,
  type ProposedAction,
  type SdkStatus,
} from "@/lib/zapier-dispatch";

export const Route = createFileRoute("/")({
  component: DispatchApp,
});

// checking  → verifying SDK auth on load
// not_connected → SDK unauthenticated: show setup instructions
// connecting → loading the authenticated account's connections
// connected  → prioritize apps + paste transcript
// review / executed → per the analyze → run flow
type Phase = "checking" | "not_connected" | "connecting" | "connected" | "review" | "executed";

/** Per-target streaming status shown while extraction is in flight. Keyed by
 * connectionId so the same app under two accounts stays distinct. */
export type AppProgress = {
  connectionId: string;
  appId: string;
  appName: string;
  accountLabel: string;
  status: "pending" | "done" | "error";
  count: number;
  error?: string;
};

function DispatchApp() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [sdkStatus, setSdkStatus] = useState<SdkStatus | null>(null);
  const [connections, setConnections] = useState<ConnectedApp[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [transcript, setTranscript] = useState<string>(SAMPLE_TRANSCRIPT_TEXT);
  // appKey -> chosen connectionId. Presence of a key means the app is selected.
  const [selectedByApp, setSelectedByApp] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<AppProgress[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // On load, check whether the Zapier SDK is authenticated. If it is, load the
  // account's connections and go to the app; if not, show setup instructions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let status: SdkStatus;
      try {
        status = await getSdkStatus();
      } catch (e) {
        status = {
          connected: false,
          error: e instanceof Error ? e.message : "Couldn't reach the Zapier SDK.",
        };
      }
      if (cancelled) return;
      setSdkStatus(status);
      if (!status.connected) {
        setPhase("not_connected");
        return;
      }
      setPhase("connecting");
      const [conns, accts] = await Promise.all([getConnections(), getConnectedAccounts()]);
      if (cancelled) return;
      setConnections(conns);
      setAccounts(accts);
      setPhase("connected");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAnalyze() {
    // Build one target per selected app, bound to its chosen connection.
    const targets: AnalysisTarget[] = Object.entries(selectedByApp)
      .map(([appKey, connectionId]) => {
        const acct = accounts.find((a) => a.appKey === appKey && a.connectionId === connectionId);
        if (!acct) return null;
        return {
          appKey,
          connectionId,
          appName: acct.appName,
          accountLabel: acct.accountLabel,
        };
      })
      .filter((t): t is AnalysisTarget => t !== null);
    if (targets.length === 0) return;

    // Reset for a fresh run and seed per-target progress so the UI can show
    // each selected account as "pending" until its batch streams back.
    setActions([]);
    setIncluded({});
    setResults([]);
    setActiveActionId(null);
    setProgress(
      targets.map((t) => ({
        connectionId: t.connectionId,
        appId: t.appKey,
        appName: t.appName,
        accountLabel: t.accountLabel,
        status: "pending",
        count: 0,
      })),
    );
    setAnalyzing(true);
    setPhase("review");

    try {
      const stream = await analyzeTranscriptStream(transcript, targets);
      // Consume each target's result as it lands (completion order) and merge.
      for await (const result of stream) {
        applyAppResult(result);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Analysis failed.";
      // Mark any still-pending targets as errored so the UI never hangs.
      setProgress((prev) =>
        prev.map((p) => (p.status === "pending" ? { ...p, status: "error", error: message } : p)),
      );
    } finally {
      setAnalyzing(false);
    }
  }

  /** Merge one streamed per-target result into actions + progress. */
  function applyAppResult(result: AppAnalysisResult) {
    setActions((prev) => [...prev, ...result.actions]);
    setIncluded((prev) => ({
      ...prev,
      ...Object.fromEntries(result.actions.map((a) => [a.id, isActionComplete(a)])),
    }));
    setProgress((prev) =>
      prev.map((p) =>
        p.connectionId === result.connectionId
          ? {
              ...p,
              status: result.status,
              count: result.actions.length,
              error: result.error,
            }
          : p,
      ),
    );
  }

  async function handleRun() {
    const toRun = actions.filter((a) => included[a.id]);
    if (toRun.length === 0) return;
    const res = await executeActions(toRun);
    setResults(res);
    setPhase("executed");
  }

  function resetToConnected() {
    setActions([]);
    setResults([]);
    setIncluded({});
    setProgress([]);
    setActiveActionId(null);
    setPhase("connected");
  }

  return (
    <div className="min-h-screen grid-bg">
      <TopBar sdkStatus={sdkStatus} connectionCount={connections.length} phase={phase} />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        {(phase === "checking" || phase === "connecting") && (
          <Connecting label="Loading your connected apps…" />
        )}
        {phase === "not_connected" && <NotConnected status={sdkStatus} />}
        {phase === "connected" && (
          <Connected
            accounts={accounts}
            transcript={transcript}
            onTranscriptChange={setTranscript}
            selectedByApp={selectedByApp}
            onToggleApp={(appKey, defaultConnectionId) =>
              setSelectedByApp((prev) => {
                const next = { ...prev };
                if (appKey in next) delete next[appKey];
                else next[appKey] = defaultConnectionId;
                return next;
              })
            }
            onChooseAccount={(appKey, connectionId) =>
              setSelectedByApp((prev) => ({ ...prev, [appKey]: connectionId }))
            }
            onClearAll={() => setSelectedByApp({})}
            onAnalyze={handleAnalyze}
          />
        )}
        {phase === "review" && (
          <Review
            transcript={transcript}
            actions={actions}
            setActions={setActions}
            included={included}
            setIncluded={setIncluded}
            progress={progress}
            analyzing={analyzing}
            activeActionId={activeActionId}
            setActiveActionId={setActiveActionId}
            onRun={handleRun}
            onBack={resetToConnected}
          />
        )}
        {phase === "executed" && (
          <Executed actions={actions} results={results} onReset={resetToConnected} />
        )}
      </main>
    </div>
  );
}

/* ─────────────────────── Chrome ─────────────────────── */

function TopBar({
  sdkStatus,
  connectionCount,
  phase,
}: {
  sdkStatus: SdkStatus | null;
  connectionCount: number;
  phase: Phase;
}) {
  return (
    <header className="border-b border-border bg-surface/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <div className="flex items-center gap-3">
          <div className="grid h-7 w-7 place-items-center rounded-sm border border-border-strong bg-surface-2">
            <div className="h-2 w-2 rounded-full bg-status-review shadow-[0_0_10px_var(--status-review)]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">Dispatch</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              v0.1 · internal
            </span>
          </div>
        </div>
        <SdkStatusPill sdkStatus={sdkStatus} connectionCount={connectionCount} phase={phase} />
      </div>
    </header>
  );
}

/** Reflects the SDK connection: green with the authenticated account email when
 * connected, neutral otherwise. Replaces the old "Sign in with Zapier" button —
 * auth happens out-of-band via the CLI, not in the browser. */
function SdkStatusPill({
  sdkStatus,
  connectionCount,
  phase,
}: {
  sdkStatus: SdkStatus | null;
  connectionCount: number;
  phase: Phase;
}) {
  if (phase === "checking" || sdkStatus === null) {
    return <Pill dot="bg-status-review animate-pulse">Checking SDK…</Pill>;
  }
  if (!sdkStatus.connected) {
    return <Pill dot="bg-muted-foreground">SDK not connected</Pill>;
  }
  const suffix =
    phase === "connecting"
      ? " · loading apps…"
      : connectionCount > 0
        ? ` · ${connectionCount} apps`
        : "";
  return (
    <Pill dot="bg-status-success">
      <span className="text-status-success">SDK connected</span>
      {sdkStatus.email ? ` · ${sdkStatus.email}` : ""}
      {suffix}
    </Pill>
  );
}

function Pill({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </div>
  );
}

/* ─────────────────────── Phase: not connected ─────────────────────── */

/** Shown when the Zapier SDK has no working credentials. Auth happens
 * out-of-band via the CLI (not in the browser), so this is a setup guide:
 * clone the public repo, log the SDK in, and run the app. */
function NotConnected({ status }: { status: SdkStatus | null }) {
  return (
    <div className="mx-auto max-w-2xl pt-12">
      <div className="rounded-md border border-border bg-card p-8 shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset]">
        <div className="font-mono text-[11px] uppercase tracking-widest text-status-review">
          Setup / Connect the Zapier SDK
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          The Zapier SDK isn&rsquo;t connected yet.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Dispatch runs against your own Zapier account through the Zapier SDK. Authentication
          happens on your machine via the SDK CLI — not in this browser. Run the steps below, then
          refresh this page.
        </p>

        {status?.error && (
          <div className="mt-4 rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[11px] text-muted-foreground">
            SDK status: {status.error}
          </div>
        )}

        <ol className="mt-6 space-y-5">
          <Step n={1} title="Clone the repo and install">
            <CommandBlock
              lines={[
                "git clone https://github.com/tomnassr/action-dispatcher.git",
                "cd action-dispatcher",
                "npm install",
              ]}
            />
          </Step>
          <Step n={2} title="Connect the Zapier SDK (browser login)">
            <CommandBlock
              lines={["npm install -D @zapier/zapier-sdk-cli", "npx zapier-sdk login"]}
            />
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              <code className="font-mono">login</code> opens Zapier in your browser to authorize.
              The SDK reads the resulting credentials automatically — no env var needed for local
              dev. (For CI / production, set <code className="font-mono">ZAPIER_CREDENTIALS</code>{" "}
              in <code className="font-mono">.dev.vars</code> instead.)
            </p>
          </Step>
          <Step n={3} title="Run the app">
            <CommandBlock lines={["npm run dev"]} />
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Then reload this page — once the SDK is authenticated, Dispatch loads your connected
              apps automatically.
            </p>
          </Step>
        </ol>

        <div className="mt-7 flex items-center justify-between gap-4 border-t border-border pt-5">
          <span className="font-mono text-[11px] text-muted-foreground">
            Repo:{" "}
            <a
              href="https://github.com/tomnassr/action-dispatcher"
              target="_blank"
              rel="noopener noreferrer"
              className="text-status-review underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              github.com/tomnassr/action-dispatcher
            </a>
          </span>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
          >
            Reload &amp; re-check
            <span aria-hidden>↺</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-border-strong bg-surface-2 font-mono text-[11px] text-muted-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/** A copyable terminal block. Each line is a shell command. */
function CommandBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard?.writeText(lines.join("\n")).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  }
  return (
    <div className="group relative overflow-hidden rounded-sm border border-border bg-surface">
      <button
        onClick={copy}
        className="absolute right-1.5 top-1.5 rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-foreground">
        {lines.map((l) => (
          <div key={l}>
            <span className="select-none text-muted-foreground">$ </span>
            {l}
          </div>
        ))}
      </pre>
    </div>
  );
}

/* ─────────────────────── Phase: connecting ─────────────────────── */

function Connecting({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-xl pt-24 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-md border border-border bg-surface">
        <div className="h-3 w-3 animate-pulse rounded-full bg-status-review shadow-[0_0_20px_var(--status-review)]" />
      </div>
      <div className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/* ─────────────────────── Phase: connected ─────────────────────── */

type AppGroup = {
  appKey: string;
  appName: string;
  category: string;
  actionCount: number;
  accounts: ConnectedAccount[];
};

function Connected({
  accounts,
  transcript,
  onTranscriptChange,
  selectedByApp,
  onToggleApp,
  onChooseAccount,
  onClearAll,
  onAnalyze,
}: {
  accounts: ConnectedAccount[];
  transcript: string;
  onTranscriptChange: (v: string) => void;
  selectedByApp: Record<string, string>;
  onToggleApp: (appKey: string, defaultConnectionId: string) => void;
  onChooseAccount: (appKey: string, connectionId: string) => void;
  onClearAll: () => void;
  onAnalyze: () => void;
}) {
  const wordCount = useMemo(
    () => (transcript.trim() ? transcript.trim().split(/\s+/).length : 0),
    [transcript],
  );

  // Group accounts by app so each app shows once, with its accounts as options.
  // Non-legacy accounts sort first so the default (accounts[0]) is a live one.
  const appGroups = useMemo<AppGroup[]>(() => {
    const byApp = new Map<string, AppGroup>();
    for (const acct of accounts) {
      let group = byApp.get(acct.appKey);
      if (!group) {
        group = {
          appKey: acct.appKey,
          appName: acct.appName,
          category: acct.category,
          actionCount: acct.actionCount,
          accounts: [],
        };
        byApp.set(acct.appKey, group);
      }
      group.accounts.push(acct);
    }
    for (const group of byApp.values()) {
      group.accounts.sort((a, b) => Number(a.isLegacy) - Number(b.isLegacy));
    }
    return [...byApp.values()].sort((a, b) => a.appName.localeCompare(b.appName));
  }, [accounts]);

  const selectedCount = Object.keys(selectedByApp).length;
  const canAnalyze = selectedCount > 0 && transcript.trim().length >= 40;

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-end justify-between">
          <SectionLabel step="Step 1" title="Prioritize apps to analyze" />
          <button
            onClick={onClearAll}
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Pick only the apps relevant to this transcript. When an app has more than one connected
          account, choose which one runs. Each selected app is analyzed on its own — one focused
          AI&nbsp;by&nbsp;Zapier pass, one Zapier task — so extraction stays accurate and runs
          against the account you picked.
        </p>
        {/* Alphabetical list view — one row per app, sorted A→Z. */}
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          {appGroups.map((group) => {
            const selected = group.appKey in selectedByApp;
            const chosenId = selectedByApp[group.appKey];
            const multi = group.accounts.length > 1;
            return (
              <div
                key={group.appKey}
                className={`transition ${selected ? "bg-status-review-bg" : "hover:bg-surface-2"}`}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => onToggleApp(group.appKey, group.accounts[0].connectionId)}
                    aria-pressed={selected}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[9px] ${
                        selected
                          ? "border-status-review bg-status-review text-status-review-foreground"
                          : "border-border-strong text-transparent"
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <AppGlyph id={group.appKey} />
                    <span className="min-w-0 truncate text-sm font-medium">{group.appName}</span>
                    <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
                      {group.category} · {group.actionCount} actions
                    </span>
                  </button>

                  {/* Account control on the right — dropdown when the app has
                      multiple accounts, else the single account's label. */}
                  {selected ? (
                    multi ? (
                      <select
                        value={chosenId}
                        onChange={(e) => onChooseAccount(group.appKey, e.target.value)}
                        className="max-w-[14rem] shrink-0 rounded-sm border border-border bg-surface px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                        aria-label={`Account for ${group.appName}`}
                      >
                        {group.accounts.map((a) => (
                          <option key={a.connectionId} value={a.connectionId}>
                            {a.accountLabel}
                            {a.isLegacy ? " (legacy)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="max-w-[14rem] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                        {group.accounts[0].accountLabel}
                      </span>
                    )
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {multi ? `${group.accounts.length} accounts` : ""}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <SectionLabel step="Step 2" title="Paste a transcript" />
        <div className="mt-3 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              transcript.txt
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">{wordCount} words</span>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => onTranscriptChange(e.target.value)}
            spellCheck={false}
            className="block h-72 w-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Paste a call or meeting transcript…"
          />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <button
            onClick={() => onTranscriptChange(SAMPLE_TRANSCRIPT_TEXT)}
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ↺ Load sample transcript
          </button>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              {selectedCount === 0
                ? "No apps selected"
                : `${selectedCount} app${selectedCount === 1 ? "" : "s"} · ~${selectedCount} Zapier task${
                    selectedCount === 1 ? "" : "s"
                  }`}
            </span>
            <button
              onClick={onAnalyze}
              disabled={!canAnalyze}
              title={
                selectedCount === 0
                  ? "Select at least one app to analyze"
                  : transcript.trim().length < 40
                    ? "Paste a longer transcript"
                    : undefined
              }
              className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analyze Transcript
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────── Streaming progress ─────────────────────── */

/** Live per-app extraction status, shown at the top of the review queue while
 * results stream in. Each app flips from a pulsing "pending" to a ✓ with its
 * action count (or an error) the instant its batch lands. */
function AnalysisProgress({
  progress,
  analyzing,
  doneCount,
}: {
  progress: AppProgress[];
  analyzing: boolean;
  doneCount: number;
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {analyzing && (
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-status-review" />
          )}
          {analyzing ? "Extracting per app" : "Extraction complete"}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {doneCount}/{progress.length} apps
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {progress.map((p) => {
          const cls =
            p.status === "done"
              ? "border-status-success/40 bg-status-success-bg text-status-success"
              : p.status === "error"
                ? "border-status-fail/40 bg-status-fail-bg text-status-fail"
                : "border-border bg-surface text-muted-foreground";
          return (
            <span
              key={p.connectionId}
              title={p.error ?? `${p.appName} · ${p.accountLabel}`}
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] ${cls}`}
            >
              <AppGlyph id={p.appId} />
              <span className="max-w-[16rem] truncate">
                {p.appName} · {p.accountLabel}
              </span>
              {p.status === "pending" && (
                <span className="animate-pulse" aria-hidden>
                  …
                </span>
              )}
              {p.status === "done" && <span aria-hidden>· {p.count} ✓</span>}
              {p.status === "error" && <span aria-hidden>· failed</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────── Phase: review ─────────────────────── */

function Review({
  transcript,
  actions,
  setActions,
  included,
  setIncluded,
  progress,
  analyzing,
  activeActionId,
  setActiveActionId,
  onRun,
  onBack,
}: {
  transcript: string;
  actions: ProposedAction[];
  setActions: (a: ProposedAction[]) => void;
  included: Record<string, boolean>;
  setIncluded: (v: Record<string, boolean>) => void;
  progress: AppProgress[];
  analyzing: boolean;
  activeActionId: string | null;
  setActiveActionId: (id: string | null) => void;
  onRun: () => void;
  onBack: () => void;
}) {
  const activeQuote = actions.find((a) => a.id === activeActionId)?.sourceQuote ?? null;

  const queuedCount = actions.filter((a) => included[a.id]).length;
  const anyBlocked = actions.some((a) => included[a.id] && !isActionComplete(a));
  const doneCount = progress.filter((p) => p.status !== "pending").length;

  function updateParam(actionId: string, key: string, value: string) {
    setActions(
      actions.map((a) =>
        a.id !== actionId
          ? a
          : {
              ...a,
              params: a.params.map((p) => (p.key === key ? { ...p, value } : p)),
            },
      ),
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Transcript pane */}
      <section className="lg:sticky lg:top-6 lg:h-fit">
        <SectionLabel step="Source" title="Transcript" />
        <div className="mt-3 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              transcript.txt · read-only
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {actions.length} extractions
            </span>
          </div>
          <TranscriptView
            transcript={transcript}
            actions={actions}
            activeQuote={activeQuote}
            onHoverQuote={(q) => {
              const match = actions.find((a) => a.sourceQuote === q);
              setActiveActionId(match?.id ?? null);
            }}
          />
        </div>
      </section>

      {/* Actions queue */}
      <section>
        <div className="flex items-end justify-between">
          <SectionLabel step="Step 3" title="Review queue" />
          <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {queuedCount} of {actions.length} queued
          </div>
        </div>

        {progress.length > 0 && (
          <AnalysisProgress progress={progress} analyzing={analyzing} doneCount={doneCount} />
        )}

        {analyzing && actions.length === 0 && (
          <div className="mt-3 rounded-md border border-dashed border-border bg-card px-4 py-6 text-center font-mono text-[12px] text-muted-foreground">
            Extracting actions… results appear here as each app finishes.
          </div>
        )}

        {!analyzing && actions.length === 0 && (
          <div className="mt-3 rounded-md border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No actions were found for the selected apps in this transcript.
          </div>
        )}

        <div className="mt-3 space-y-3">
          {actions.map((a) => {
            const complete = isActionComplete(a);
            const isActive = activeActionId === a.id;
            return (
              <div
                key={a.id}
                onMouseEnter={() => setActiveActionId(a.id)}
                onMouseLeave={() => setActiveActionId(null)}
                onFocus={() => setActiveActionId(a.id)}
                className={`group rounded-md border bg-card transition ${
                  isActive
                    ? "border-status-review shadow-[0_0_0_1px_var(--status-review)]"
                    : "border-border hover:border-border-strong"
                }`}
              >
                <div className="flex items-start gap-3 border-b border-border px-4 py-3">
                  <input
                    type="checkbox"
                    checked={!!included[a.id]}
                    onChange={(e) => setIncluded({ ...included, [a.id]: e.target.checked })}
                    className="mt-1 h-4 w-4 accent-status-success"
                    aria-label={`Include ${a.actionType}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <AppGlyph id={a.appId} />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {a.appName} · {a.actionType}
                      </span>
                      {!complete && (
                        <span className="ml-auto rounded-sm bg-status-fail-bg px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-status-fail">
                          Needs input
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      runs as {a.accountLabel}
                    </div>
                    <div className="mt-1.5 text-sm text-foreground">{a.summary}</div>
                  </div>
                </div>
                <div className="grid gap-2 px-4 py-3">
                  {a.params.map((p) => {
                    const missing = p.required && !p.value.trim();
                    return (
                      <div key={p.key} className="grid grid-cols-[110px_1fr] items-start gap-3">
                        <label className="pt-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          {p.label}
                          {p.required && <span className="text-status-fail"> *</span>}
                        </label>
                        {p.choices ? (
                          // Dynamic resource field (Slack channel, Trello board,
                          // …) — a dropdown of the account's real options,
                          // pre-selected to the AI's match, so the value sent is
                          // always a valid resource the account can target.
                          <select
                            value={p.value}
                            onChange={(e) => updateParam(a.id, p.key, e.target.value)}
                            className={`w-full rounded-sm border bg-surface px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-ring ${
                              missing ? "border-status-fail" : "border-border"
                            }`}
                          >
                            <option value="">
                              {missing ? "Select a target — required" : "Select…"}
                            </option>
                            {p.choices.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        ) : p.multiline ? (
                          <textarea
                            value={p.value}
                            onChange={(e) => updateParam(a.id, p.key, e.target.value)}
                            rows={Math.min(6, Math.max(2, p.value.split("\n").length))}
                            className={`w-full resize-none rounded-sm border bg-surface px-2.5 py-1.5 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:border-ring ${
                              missing ? "border-status-fail" : "border-border"
                            }`}
                          />
                        ) : (
                          <input
                            value={p.value}
                            onChange={(e) => updateParam(a.id, p.key, e.target.value)}
                            placeholder={missing ? "Required" : ""}
                            className={`w-full rounded-sm border bg-surface px-2.5 py-1.5 font-mono text-[12px] text-foreground outline-none placeholder:text-status-fail/70 focus:border-ring ${
                              missing ? "border-status-fail" : "border-border"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={onBack}
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ← Back to transcript
          </button>
          <div className="flex items-center gap-3">
            {analyzing && (
              <span className="font-mono text-[11px] uppercase tracking-wider text-status-review">
                Still analyzing…
              </span>
            )}
            {!analyzing && anyBlocked && (
              <span className="font-mono text-[11px] uppercase tracking-wider text-status-fail">
                Fill required fields first
              </span>
            )}
            <button
              onClick={onRun}
              disabled={queuedCount === 0 || anyBlocked}
              className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-status-success px-4 py-2 text-sm font-medium text-status-success-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Run {queuedCount || ""} Queued Action{queuedCount === 1 ? "" : "s"}
              <span aria-hidden>▸</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TranscriptView({
  transcript,
  actions,
  activeQuote,
  onHoverQuote,
}: {
  transcript: string;
  actions: ProposedAction[];
  activeQuote: string | null;
  onHoverQuote: (q: string | null) => void;
}) {
  // Build segments: split transcript on each action's sourceQuote occurrence.
  const segments = useMemo(() => {
    type Seg = { text: string; quote?: string };
    let segs: Seg[] = [{ text: transcript }];
    for (const a of actions) {
      const q = a.sourceQuote;
      const next: Seg[] = [];
      for (const s of segs) {
        if (s.quote) {
          next.push(s);
          continue;
        }
        const idx = s.text.indexOf(q);
        if (idx === -1) {
          next.push(s);
        } else {
          if (idx > 0) next.push({ text: s.text.slice(0, idx) });
          next.push({ text: q, quote: q });
          if (idx + q.length < s.text.length) next.push({ text: s.text.slice(idx + q.length) });
        }
      }
      segs = next;
    }
    return segs;
  }, [transcript, actions]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (activeQuote && activeRef.current && scrollRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeQuote]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[70vh] overflow-y-auto p-4 font-mono text-[12.5px] leading-relaxed text-muted-foreground"
    >
      <pre className="whitespace-pre-wrap font-mono">
        {segments.map((s, i) => {
          if (!s.quote) return <span key={i}>{s.text}</span>;
          const active = activeQuote === s.quote;
          return (
            <span
              key={i}
              ref={active ? activeRef : undefined}
              onMouseEnter={() => onHoverQuote(s.quote!)}
              onMouseLeave={() => onHoverQuote(null)}
              className={`mark-highlight cursor-pointer ${
                active ? "!bg-status-review !text-status-review-foreground" : ""
              }`}
              style={active ? { color: "var(--status-review-foreground)" } : undefined}
            >
              {s.text}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/* ─────────────────────── Phase: executed ─────────────────────── */

function Executed({
  actions,
  results,
  onReset,
}: {
  actions: ProposedAction[];
  results: ExecutionResult[];
  onReset: () => void;
}) {
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const failed = results.length - succeeded;
  return (
    <div>
      <div className="flex items-end justify-between">
        <SectionLabel
          step="Done"
          title={`Ran ${results.length} action${results.length === 1 ? "" : "s"}`}
        />
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider">
          <span className="text-status-success">{succeeded} succeeded</span>
          {failed > 0 && <span className="text-status-fail">{failed} failed</span>}
        </div>
      </div>
      <ol className="mt-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
        {results.map((r) => {
          const a = actions.find((x) => x.id === r.actionId)!;
          const ok = r.status === "succeeded";
          return (
            <li key={r.actionId} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  ok
                    ? "bg-status-success shadow-[0_0_10px_var(--status-success)]"
                    : "bg-status-fail shadow-[0_0_10px_var(--status-fail)]"
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <AppGlyph id={a.appId} />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {a.appName} · {a.actionType}
                  </span>
                  <span
                    className={`ml-auto rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      ok
                        ? "bg-status-success-bg text-status-success"
                        : "bg-status-fail-bg text-status-fail"
                    }`}
                  >
                    {ok ? "Succeeded" : "Failed"}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  ran as {a.accountLabel}
                </div>
                <div className="mt-1 text-sm">{a.summary}</div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">{r.message}</div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Log saved · {new Date().toLocaleString()}
        </div>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
        >
          Analyze Another Transcript
          <span aria-hidden>↺</span>
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── Bits ─────────────────────── */

function SectionLabel({ step, title }: { step: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-status-review">
        {step}
      </div>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

/** Deterministic hue per app key, so any connected app — not just a fixed
 * roster — gets a distinct, stable badge color. */
function hueFromAppId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360;
  }
  return hash;
}

function initialsFromAppId(id: string): string {
  const words = id.split(/[-_\s]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return id.slice(0, 2).toUpperCase();
}

function AppGlyph({ id }: { id: string }) {
  const hue = hueFromAppId(id);
  return (
    <span
      className="grid h-5 w-5 place-items-center rounded-sm font-mono text-[9px] font-semibold"
      style={{
        background: `oklch(0.35 0.10 ${hue})`,
        color: `oklch(0.92 0.02 ${hue})`,
      }}
    >
      {initialsFromAppId(id)}
    </span>
  );
}

function isActionComplete(a: ProposedAction): boolean {
  return a.params.every((p) => !p.required || p.value.trim().length > 0);
}

/** Joins app names into a natural-language list — works for any set of
 * connected apps, not a fixed roster. */
function formatAppList(names: string[]): string {
  if (names.length === 0) return "your connected apps";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
