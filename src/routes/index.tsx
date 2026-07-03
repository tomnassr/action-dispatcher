import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeTranscript,
  executeActions,
  getConnections,
  pollZapierConnect,
  searchZapierApps,
  startZapierConnect,
  SAMPLE_TRANSCRIPT_TEXT,
  type ConnectedApp,
  type ExecutionResult,
  type ProposedAction,
  type ZapierAppSummary,
} from "@/lib/zapier-dispatch";

export const Route = createFileRoute("/")({
  component: DispatchApp,
});

type Phase = "disconnected" | "connecting" | "connected" | "processing" | "review" | "executed";

function DispatchApp() {
  const [phase, setPhase] = useState<Phase>("disconnected");
  const [connections, setConnections] = useState<ConnectedApp[]>([]);
  const [transcript, setTranscript] = useState<string>(SAMPLE_TRANSCRIPT_TEXT);
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [signInPulse, setSignInPulse] = useState(0);

  async function handleConnect() {
    setPhase("connecting");
    const conns = await getConnections();
    setConnections(conns);
    setPhase("connected");
  }

  async function handleAnalyze() {
    setPhase("processing");
    const proposed = await analyzeTranscript(transcript);
    setActions(proposed);
    setIncluded(Object.fromEntries(proposed.map((a) => [a.id, isActionComplete(a)])));
    setPhase("review");
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
    setActiveActionId(null);
    setPhase("connected");
  }

  return (
    <div className="min-h-screen grid-bg">
      <TopBar
        phase={phase}
        connections={connections}
        onSignInClick={() => setSignInPulse((n) => n + 1)}
      />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        {phase === "disconnected" && (
          <Disconnected onConnect={handleConnect} attentionSignal={signInPulse} />
        )}
        {phase === "connecting" && <Connecting />}
        {phase === "connected" && (
          <Connected
            connections={connections}
            transcript={transcript}
            onTranscriptChange={setTranscript}
            onAnalyze={handleAnalyze}
          />
        )}
        {phase === "processing" && <Processing connections={connections} />}
        {phase === "review" && (
          <Review
            transcript={transcript}
            actions={actions}
            setActions={setActions}
            included={included}
            setIncluded={setIncluded}
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
  phase,
  connections,
  onSignInClick,
}: {
  phase: Phase;
  connections: ConnectedApp[];
  onSignInClick: () => void;
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
        <div className="flex items-center gap-2">
          {phase === "disconnected" && (
            <button
              onClick={onSignInClick}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border-strong bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition hover:brightness-110"
            >
              Sign in with Zapier
              <span aria-hidden>→</span>
            </button>
          )}
          <StatusPill phase={phase} count={connections.length} />
        </div>
      </div>
    </header>
  );
}

function StatusPill({ phase, count }: { phase: Phase; count: number }) {
  const dot =
    phase === "disconnected"
      ? "bg-muted-foreground"
      : phase === "connecting" || phase === "processing"
        ? "bg-status-review animate-pulse"
        : "bg-status-success";
  const label =
    phase === "disconnected"
      ? "Not connected"
      : phase === "connecting"
        ? "Loading connections"
        : phase === "processing"
          ? "Extracting actions"
          : `${count} apps connected`;
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </div>
  );
}

/* ─────────────────────── Phase: disconnected ─────────────────────── */

const POPULAR_APP_SEARCHES = ["Gmail", "Slack", "HubSpot", "Google Calendar", "Notion"];

function Disconnected({
  onConnect,
  attentionSignal,
}: {
  onConnect: () => void;
  attentionSignal: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZapierAppSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState(false);
  const cancelRef = useRef(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Fired every time the "Sign in with Zapier" button in the top bar is
  // clicked, even though this card is already on screen — scroll it into
  // view, focus the search box, and flash a highlight so the click is
  // never a silent no-op.
  useEffect(() => {
    if (attentionSignal === 0) return;
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    searchInputRef.current?.focus();
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), 900);
    return () => clearTimeout(timer);
  }, [attentionSignal]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const found = await searchZapierApps(term);
        setResults(found);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query]);

  async function handleConnectApp(appKey: string) {
    cancelRef.current = false;
    setError(null);
    setConnectingKey(appKey);
    try {
      const { url, startedAt } = await startZapierConnect(appKey);
      // Real Zapier-hosted sign-in — the user authorizes with their own
      // Zapier credentials in this new tab, not a fake local delay.
      window.open(url, "_blank", "noopener,noreferrer");

      const deadline = Date.now() + 5 * 60 * 1000;
      let connected: ConnectedApp | null = null;
      while (!connected && !cancelRef.current && Date.now() < deadline) {
        connected = await pollZapierConnect(appKey, startedAt);
      }

      if (cancelRef.current) return;
      if (!connected) {
        setError(`Timed out waiting for ${appKey} to authorize. Try again.`);
        return;
      }
      setConnectedApps((prev) => [...prev.filter((a) => a.id !== connected!.id), connected!]);
      setQuery("");
      setResults([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong connecting that app.");
    } finally {
      setConnectingKey(null);
    }
  }

  function handleCancelConnect() {
    cancelRef.current = true;
    setConnectingKey(null);
  }

  return (
    <div className="mx-auto max-w-xl pt-16">
      <div
        ref={cardRef}
        className={`rounded-md border border-border bg-card p-8 shadow-[0_1px_0_0_oklch(1_0_0_/_0.04)_inset] transition-shadow duration-300 ${
          pulsing ? "!border-status-review shadow-[0_0_0_3px_var(--status-review)]" : ""
        }`}
      >
        <div className="font-mono text-[11px] uppercase tracking-widest text-status-review">
          Step 1 / Connect
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Sign in with Zapier to connect your apps.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Search Zapier's full app catalog and authorize each one with your own Zapier account —
          this isn't limited to a fixed set of integrations.
        </p>

        {connectedApps.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {connectedApps.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-sm border border-status-success/40 bg-status-success-bg px-2 py-1 font-mono text-[11px] text-status-success"
              >
                <AppGlyph id={a.id} />
                {a.name}
                <span aria-hidden>✓</span>
              </span>
            ))}
          </div>
        )}

        <div className="mt-6">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for an app — Gmail, Slack, Notion, HubSpot…"
            spellCheck={false}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {POPULAR_APP_SEARCHES.map((label) => (
              <button
                key={label}
                onClick={() => setQuery(label)}
                className="rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition hover:border-border-strong hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {searching && (
          <div className="mt-3 font-mono text-[11px] text-muted-foreground">Searching…</div>
        )}

        {!searching && results.length > 0 && (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-sm border border-border">
            {results.map((app) => {
              const isConnected = connectedApps.some((a) => a.id === app.key);
              const isConnecting = connectingKey === app.key;
              return (
                <li
                  key={app.key}
                  className="flex items-center justify-between gap-3 bg-surface px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <AppGlyph id={app.key} />
                    <span className="text-sm">{app.title}</span>
                  </div>
                  {isConnected ? (
                    <span className="font-mono text-[11px] text-status-success">Connected ✓</span>
                  ) : isConnecting ? (
                    <div className="flex items-center gap-2">
                      <span className="animate-pulse font-mono text-[11px] text-muted-foreground">
                        Waiting for authorization…
                      </span>
                      <button
                        onClick={handleCancelConnect}
                        className="font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleConnectApp(app.key)}
                      disabled={connectingKey !== null}
                      className="rounded-sm border border-border-strong bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Connect
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {error && <div className="mt-3 font-mono text-[11px] text-status-fail">{error}</div>}

        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="font-mono text-[11px] text-muted-foreground">
            Each app opens Zapier's own sign-in page in a new tab.
          </div>
          <button
            onClick={onConnect}
            disabled={connectedApps.length === 0}
            className="inline-flex shrink-0 items-center gap-2 rounded-sm border border-border-strong bg-status-success px-4 py-2 text-sm font-medium text-status-success-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue
            <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Phase: connecting ─────────────────────── */

function Connecting() {
  return (
    <div className="mx-auto max-w-xl pt-24 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-md border border-border bg-surface">
        <div className="h-3 w-3 animate-pulse rounded-full bg-status-review shadow-[0_0_20px_var(--status-review)]" />
      </div>
      <div className="mt-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Loading your connected apps…
      </div>
    </div>
  );
}

/* ─────────────────────── Phase: connected ─────────────────────── */

function Connected({
  connections,
  transcript,
  onTranscriptChange,
  onAnalyze,
}: {
  connections: ConnectedApp[];
  transcript: string;
  onTranscriptChange: (v: string) => void;
  onAnalyze: () => void;
}) {
  const wordCount = useMemo(
    () => (transcript.trim() ? transcript.trim().split(/\s+/).length : 0),
    [transcript],
  );
  return (
    <div className="space-y-8">
      <section>
        <SectionLabel step="Step 2" title="Live connections" />
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {connections.map((c) => (
            <div key={c.id} className="rounded-sm border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <AppGlyph id={c.id} />
                <span className="text-sm font-medium">{c.name}</span>
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {c.category} · {c.actionCount} actions
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionLabel step="Step 3" title="Paste a transcript" />
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
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => onTranscriptChange(SAMPLE_TRANSCRIPT_TEXT)}
            className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            ↺ Load sample transcript
          </button>
          <button
            onClick={onAnalyze}
            disabled={transcript.trim().length < 40}
            className="inline-flex items-center gap-2 rounded-sm border border-border-strong bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Analyze Transcript
            <span aria-hidden>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────── Phase: processing ─────────────────────── */

function Processing({ connections }: { connections: ConnectedApp[] }) {
  const appNames = connections.map((c) => c.name);
  return (
    <div className="mx-auto max-w-xl pt-24 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-md border border-border bg-surface">
        <div className="h-3 w-3 animate-pulse rounded-full bg-status-review shadow-[0_0_20px_var(--status-review)]" />
      </div>
      <h2 className="mt-6 text-lg font-semibold">
        Reading transcript against your live action catalog.
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Matching phrases to actions available on {formatAppList(appNames)}.
      </p>
      <div className="mx-auto mt-8 max-w-md space-y-2 text-left font-mono text-[12px] text-muted-foreground">
        {[
          "▸ tokenizing 47 lines",
          "▸ matching intents → action catalog",
          "▸ extracting parameters",
          "▸ ranking by confidence",
        ].map((l, i) => (
          <div key={l} style={{ animationDelay: `${i * 200}ms` }} className="animate-pulse">
            {l}
          </div>
        ))}
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
  activeActionId: string | null;
  setActiveActionId: (id: string | null) => void;
  onRun: () => void;
  onBack: () => void;
}) {
  const activeQuote = actions.find((a) => a.id === activeActionId)?.sourceQuote ?? null;

  const queuedCount = actions.filter((a) => included[a.id]).length;
  const anyBlocked = actions.some((a) => included[a.id] && !isActionComplete(a));

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
          <SectionLabel step="Step 4" title="Review queue" />
          <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {queuedCount} of {actions.length} queued
          </div>
        </div>
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
                        {p.multiline ? (
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
            {anyBlocked && (
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
