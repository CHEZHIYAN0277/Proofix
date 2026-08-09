import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sidebar, type SidebarRepo, type SidebarRun } from "@/components/proofix/Sidebar";
import { RunReport } from "@/components/proofix/RunReport";
import { AgentCard } from "@/components/proofix/AgentCard";
import { AgentRail } from "@/components/proofix/AgentRail";
import { ChatPanel } from "@/components/proofix/ChatPanel";
import { StatusBadge } from "@/components/proofix/StatusBadge";
import { AnimatedNumber } from "@/components/proofix/AnimatedNumber";

import { useExecutionRun, type LiveAgent } from "@/components/proofix/useExecutionRun";
import { EvidenceHandoff } from "@/components/proofix/AgentVisualization";
import { NewRunScreen } from "@/components/proofix/NewRunScreen";
import { AnalyzingSequence } from "@/components/proofix/AnalyzingSequence";

import { RetrySequence } from "@/components/proofix/RetrySequence";

import { ProgressRing } from "@/components/proofix/ProgressRing";
import { GitBranch, Hash, Clock, RefreshCcw, Sparkles, GitPullRequest } from "lucide-react";
import {
  RUN_NAME_POOL,
  type WorkspaceHeaderModel,
  type ExecutiveSummaryModel,
  type RunReportModel,
} from "@/mocks";
import { useRunData } from "@/components/proofix/useRunData";
import { resolveRunLifecycle, type RunLifecycleView } from "@/components/proofix/runLifecycle";
import { askChat, createRun, eventSourceFor, isLive } from "@/lib/runService";

type View = "execution" | "new-run" | "analyzing" | "settings" | "home" | "runs";

/** Placeholder id used by the bundled fixtures; never exists on a backend. */
const MOCK_RUN_ID = "vulnapi-live";

const ACTIVE_AGENT_ANCHOR_PX = 140;
const ACTIVE_AGENT_ANCHOR_MIN_PX = 120;
const ACTIVE_AGENT_ANCHOR_MAX_PX = 150;
const AGENT_LAYOUT_SETTLE_TIMEOUT_MS = 1400;

function getAgentHeader(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-execution-agent-index="${index}"] [data-execution-agent-header="true"]`,
  );
}

function scrollAgentHeaderToAnchor(header: HTMLElement, behavior: ScrollBehavior) {
  const top = header.getBoundingClientRect().top + window.scrollY - ACTIVE_AGENT_ANCHOR_PX;
  window.scrollTo({ top: Math.max(0, top), behavior });
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForTimelineLayoutToSettle() {
  await nextFrame();
  await nextFrame();

  const animations = document
    .getAnimations()
    .filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      if (!timing || timing.iterations === Infinity) return false;
      return animation.playState === "running";
    })
    .map((animation) => animation.finished.catch(() => undefined));

  if (animations.length === 0) return;

  await Promise.race([
    Promise.all(animations),
    new Promise<void>((resolve) => window.setTimeout(resolve, AGENT_LAYOUT_SETTLE_TIMEOUT_MS)),
  ]);

  await nextFrame();
}

function parseRepoName(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[1]?.replace(/\.git$/, "") || parts[0] || "repository";
  } catch {
    const m = url.match(/([^/]+?)(?:\.git)?\/?$/);
    return m?.[1] || "repository";
  }
}

export interface WorkspaceProps {
  /**
   * Run to display, from the `/runs/$runId` path. Absent on `/`, which is the
   * landing route: live mode opens the new-run screen there rather than
   * silently resurrecting whichever run happened to finish last.
   */
  runId?: string;
}

export function Workspace({ runId: routeRunId }: WorkspaceProps = {}) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>(() => (isLive && !routeRunId ? "new-run" : "execution"));
  // Single source of truth for the currently visible run. The route param wins
  // when present so a shared link opens exactly the run it names.
  const [runId, setRunId] = useState<string>(routeRunId ?? MOCK_RUN_ID);
  const [runDone, setRunDone] = useState(false);

  // View models come from the backend when live, fixtures otherwise.
  const runData = useRunData(runId, runDone);

  // The journal replays backend events over the live agent list; in mock mode
  // this falls back to the bundled timing source.
  const eventSource = useMemo(() => eventSourceFor(runId), [runId]);
  const {
    agents,
    activeIndex,
    restart,
    done: journalDone,
    settledState,
  } = useExecutionRun({
    agents: runData.agents,
    createEventSource: eventSource,
    seedStatusFromAgents: isLive,
  });

  // How the backend says this run ended. The journal's own `done` only knows
  // that its replay reached the end, which never happens for a run that stopped
  // early — the header stayed on `Status · Running` for a run blocked minutes
  // ago. Either source settling the run is enough.
  const lifecycle = useMemo(
    () =>
      resolveRunLifecycle({
        status: runData.header.status,
        lifecycle: runData.header.lifecycle,
        environment: runData.header.environment,
        decisionLabel: runData.header.decisionLabel,
      }),
    [runData.header],
  );

  // The run is over. Deliberately shadowing the old `done`: every place that
  // asked "has the journal finished playing?" actually meant "is the run
  // over?", and the two only ever agreed for a run that reached A10. A blocked
  // run answered no to the first forever.
  const done = journalDone || lifecycle.terminal;

  // Which ending, preferring whichever source has spoken. Mock mode has no
  // backend status, so its journal completing means completed.
  const runState = lifecycle.terminal ? lifecycle.state : (settledState ?? "running");

  useEffect(() => {
    setRunDone(done);
  }, [done]);

  /**
   * Which agent holds the stage.
   *
   * `null` means "follow the pipeline" — the stage tracks whichever agent is
   * executing, which is the default and the whole point of the layout. A number
   * means the user pulled an earlier stage up from the rail to re-read it; the
   * stage stops following until they come back, so the pipeline advancing
   * underneath cannot yank the card out from under them mid-read.
   */
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);
  const reviewing = reviewIndex !== null && !done;
  const focusIndex = reviewing ? reviewIndex : activeIndex;

  // Per-card user overrides on top of the default expansion rule.
  // Default: only the currently-running agent is expanded.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  const toggleOverride = (i: number, defaultExpanded: boolean) => {
    setOverrides((prev) => {
      const current = prev[i] ?? defaultExpanded;
      return { ...prev, [i]: !current };
    });
  };

  // Follow the URL: back/forward between runs swaps the workspace's run.
  useEffect(() => {
    if (!routeRunId || routeRunId === runId) return;
    setRunId(routeRunId);
    setOverrides({});
    setReviewIndex(null);
    setView("execution");
  }, [routeRunId]);

  const { repositories, setRepositories, refreshRepositories } = runData;
  const [pendingRepo, setPendingRepo] = useState<string>("");

  // Against a live backend the fixture run id does not exist, and there is no
  // run to show until the URL names one. Landing on `/` means "start
  // something" — the sidebar is there for opening past runs deliberately.
  useEffect(() => {
    if (!isLive || routeRunId || runId !== MOCK_RUN_ID) return;
    setView("new-run");
  }, [routeRunId, runId]);
  const [showRunReport, setShowRunReport] = useState(false);
  const prevDone = useRef(false);
  const repairAttemptsRef = useRef<HTMLDivElement | null>(null);
  const pendingRunIdRef = useRef<Promise<string | null> | null>(null);
  const executiveSummaryRef = useRef<HTMLDivElement | null>(null);
  const activeScrollGenerationRef = useRef(0);
  const anchoredAgentRef = useRef<number | null>(null);
  const primaryAlignUntilRef = useRef(0);

  useEffect(() => {
    if (done && !prevDone.current) {
      if (isLive) {
        // Re-read the sidebar: the real outcome may be merge, draft or failed,
        // and only the backend knows which. Hardcoding "draft" here reported a
        // verdict the pipeline never reached.
        refreshRepositories();
      } else {
        setRepositories((prev) =>
          prev.map((r) => ({
            ...r,
            runs: r.runs.map((run) =>
              run.id === runId ? { ...run, status: "draft" as const, time: "just now" } : run,
            ),
          })),
        );
      }
      // The reveal below narrates a repair: it scrolls through repair attempts
      // to the executive summary and opens the run report. A run that never
      // generated a patch has none of that to show, so it settles in place and
      // leaves the environment card as the last thing on screen.
      if (runState !== "completed") {
        setShowRunReport(false);
        prevDone.current = done;
        return;
      }

      // End-of-run storytelling:
      //  1) 700ms pause, then gently scroll to Repair Attempts (git-history reveal).
      //  2) Attempts stagger in (~540ms) + 700ms breathing room.
      //  3) Smooth-scroll to the AI Executive Summary.
      //  4) Once the summary is in view, fade in the Run Report panel from the right.
      setShowRunReport(false);
      const REVEAL_ATTEMPTS_AT = 700;
      const SCROLL_TO_SUMMARY_AT = REVEAL_ATTEMPTS_AT + 540 + 700; // ~1940ms
      const REVEAL_REPORT_AT = SCROLL_TO_SUMMARY_AT + 650;

      const t1 = window.setTimeout(() => {
        repairAttemptsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, REVEAL_ATTEMPTS_AT);
      const t2 = window.setTimeout(() => {
        const el = executiveSummaryRef.current;
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 24;
          window.scrollTo({ top, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }, SCROLL_TO_SUMMARY_AT);
      const t3 = window.setTimeout(() => {
        setShowRunReport(true);
      }, REVEAL_REPORT_AT);
      prevDone.current = done;
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        window.clearTimeout(t3);
      };
    }
    if (!done) setShowRunReport(false);
    prevDone.current = done;
    // setRepositories is a stable useState setter, surfaced via useRunData.
  }, [done, runState, runId, setRepositories]);

  useEffect(() => {
    if (done || view !== "execution") return;

    const generation = activeScrollGenerationRef.current + 1;
    activeScrollGenerationRef.current = generation;
    anchoredAgentRef.current = null;

    let cancelled = false;

    waitForTimelineLayoutToSettle().then(() => {
      if (cancelled || activeScrollGenerationRef.current !== generation) return;
      const header = getAgentHeader(activeIndex);
      if (!header) return;
      scrollAgentHeaderToAnchor(header, "smooth");
      primaryAlignUntilRef.current = performance.now() + 750;

      window.setTimeout(() => {
        requestAnimationFrame(() => {
          if (cancelled || activeScrollGenerationRef.current !== generation) return;
          const settledHeader = getAgentHeader(activeIndex);
          if (!settledHeader) return;
          const { top } = settledHeader.getBoundingClientRect();
          if (top < ACTIVE_AGENT_ANCHOR_MIN_PX || top > ACTIVE_AGENT_ANCHOR_MAX_PX) {
            scrollAgentHeaderToAnchor(settledHeader, "smooth");
          }
          anchoredAgentRef.current = activeIndex;
        });
      }, 780);
    });

    return () => {
      cancelled = true;
    };
  }, [activeIndex, done, view]);

  // Streaming auto-follow: as the active agent grows (new lines, graphs,
  // visualizations), gently scroll the viewport downward so the newest
  // content stays visible — like ChatGPT / Cursor. Never pushes the header
  // above ~80px from the top; never scrolls up.
  useEffect(() => {
    if (done || view !== "execution") return;
    const article = document.querySelector<HTMLElement>(
      `[data-execution-agent-index="${activeIndex}"]`,
    );
    if (!article) return;

    let raf = 0;
    let lastBottom = 0;

    const follow = () => {
      raf = 0;
      if (anchoredAgentRef.current !== activeIndex) return;
      if (performance.now() < primaryAlignUntilRef.current) return;
      const rect = article.getBoundingClientRect();
      const vh = window.innerHeight;
      const bottomPadding = 140;
      const overflow = rect.bottom - (vh - bottomPadding);
      if (overflow <= 4) {
        lastBottom = rect.bottom;
        return;
      }
      // Only follow when the card is actually growing downward.
      const grew = rect.bottom - lastBottom > 0.5;
      lastBottom = rect.bottom;
      if (!grew) return;

      const header = getAgentHeader(activeIndex);
      const headerTop = header?.getBoundingClientRect().top ?? rect.top;
      const minHeaderTop = 72; // don't push header above this
      const maxDelta = Math.max(0, headerTop - minHeaderTop);
      const delta = Math.min(overflow, maxDelta);
      if (delta < 4) return;
      window.scrollBy({ top: delta, behavior: "smooth" });
    };

    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(follow);
    };

    lastBottom = article.getBoundingClientRect().bottom;
    const observer = new ResizeObserver(schedule);
    observer.observe(article);

    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeIndex, done, view]);

  const handleNewRun = () => {
    setView("new-run");
    if (isLive) void navigate({ to: "/" });
  };

  const handleAnalyze = (url: string) => {
    setPendingRepo(parseRepoName(url));
    setView("analyzing");
    // Start the pipeline immediately so the backend works while the
    // analyzing animation plays; the id resolves before the journal opens.
    pendingRunIdRef.current = createRun(url).catch(() => null);
  };

  const handleAnalyzeComplete = async () => {
    const repoName = pendingRepo || "repository";
    const createdId = await (pendingRunIdRef.current ?? Promise.resolve(null));
    const newRunId = createdId ?? `run-${Date.now()}`;

    if (isLive) {
      // Ask the backend what this run is called rather than inventing a name.
      // The sidebar entry — its name, status and age — is the backend's to
      // report; synthesising one here produced a run that looked real but
      // described nothing that actually happened.
      refreshRepositories();
    } else {
      const existing = repositories.find((r) => r.name === repoName);
      const runName = RUN_NAME_POOL[(existing?.runs.length ?? 0) % RUN_NAME_POOL.length];
      const newRun: SidebarRun = { id: newRunId, name: runName, status: "running", time: "now" };
      setRepositories((prev) => {
        const exists = prev.some((r) => r.name === repoName);
        if (exists) {
          return prev.map((r) => (r.name === repoName ? { ...r, runs: [newRun, ...r.runs] } : r));
        }
        return [{ name: repoName, runs: [newRun] }, ...prev];
      });
    }

    setRunId(newRunId);
    setOverrides({});
    setReviewIndex(null);
    setView("execution");
    restart();
    // Give the new run its own URL so it is shareable and survives a reload.
    if (isLive) void navigate({ to: "/runs/$runId", params: { runId: newRunId } });
  };

  const handleSelectRun = (selectedRunId: string) => {
    setRunId(selectedRunId);
    setOverrides({});
    setReviewIndex(null);
    setView("execution");
    if (isLive) void navigate({ to: "/runs/$runId", params: { runId: selectedRunId } });
  };

  const handleNavigate = (key: "home" | "runs" | "settings") => {
    setView(key);
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar
        onNewRun={handleNewRun}
        onNavigate={handleNavigate}
        currentView={view}
        repositories={repositories}
        activeRunId={done ? null : runId}
        selectedRunId={runId}
        onSelectRun={handleSelectRun}
      />

      <main className="min-w-0 flex-1">
        {view === "new-run" && <NewRunScreen onAnalyze={handleAnalyze} />}
        {view === "analyzing" && (
          <AnalyzingSequence
            repo={pendingRepo}
            onComplete={handleAnalyzeComplete}
            waitFor={isLive ? pendingRunIdRef.current : null}
          />
        )}
        {(view === "home" || view === "runs" || view === "settings") && <SimpleView label={view} />}
        {view === "execution" && isLive && runData.loading && <WorkspaceLoading />}
        {view === "execution" && !(isLive && runData.loading) && (
          <div className="mx-auto flex max-w-[1480px] gap-6 px-6 py-6">
            <div className={`min-w-0 flex-1 space-y-6 ${done ? "pb-[160px]" : "pb-24"}`}>
              {runData.status.header.error && (
                <PanelError
                  panel="run header"
                  message={runData.status.header.error}
                  onRetry={runData.retry}
                />
              )}
              <WorkspaceHeader done={done} header={runData.header} lifecycle={lifecycle} />
              <div ref={executiveSummaryRef} className="scroll-mt-6 space-y-3">
                {runData.status.summary.error && (
                  <PanelError
                    panel="executive summary"
                    message={runData.status.summary.error}
                    onRetry={runData.retry}
                  />
                )}
                <ExecutiveSummary
                  agents={agents}
                  activeIndex={activeIndex}
                  done={done}
                  summary={runData.summary}
                  report={runData.report}
                />
              </div>

              <section>
                <SectionHeading
                  eyebrow="Execution Journal"
                  title={done ? "Full execution timeline" : "Live execution timeline"}
                />

                {runData.status.agents.error && (
                  <div className="mt-4">
                    <PanelError
                      panel="the execution journal"
                      message={runData.status.agents.error}
                      onRetry={runData.retry}
                    />
                  </div>
                )}

                {/* Stages already passed. Mid-run this is the only way back to
                    them, since the stage below shows one agent at a time. */}
                <div className="mt-4">
                  <AgentRail
                    agents={agents}
                    activeIndex={activeIndex}
                    focusIndex={focusIndex}
                    onFocus={setReviewIndex}
                    done={done}
                  />
                </div>

                {reviewing && (
                  <button
                    type="button"
                    onClick={() => setReviewIndex(null)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-status-running/40
                      bg-status-running-bg px-2.5 py-1 text-xs font-medium text-status-running
                      transition-transform duration-150 ease-out hover:-translate-y-px"
                  >
                    <RefreshCcw className="h-3 w-3" strokeWidth={2.5} />
                    Back to live stage
                  </button>
                )}

                <div className="mt-4 space-y-3">
                  {agents.map((entry, i) => {
                    // One agent holds the stage at a time: the one executing, or
                    // whichever the user pulled up from the rail. A settled run
                    // is a record rather than a performance, so it opens out and
                    // shows every stage at once.
                    if (!done && i !== focusIndex) return null;
                    const prev = agents[i - 1];
                    const prevDone =
                      prev &&
                      (prev.liveStatus === "completed" ||
                        prev.liveStatus === "draft" ||
                        prev.liveStatus === "failed");
                    const showHandoff = i > 0 && prevDone && i <= activeIndex;
                    const isActive = i === activeIndex && !done;
                    // Mid-run only one card is on screen, so it is always open;
                    // collapsing it would leave the stage empty.
                    const defaultExpanded = done ? isActive : true;
                    const expanded = overrides[i] ?? defaultExpanded;
                    return (
                      <div key={entry.id}>
                        {showHandoff && (
                          <div className="animate-fade-in">
                            <EvidenceHandoff
                              label={prev?.handoff ?? "evidence"}
                              toLabel={entry.handoff}
                              live={isActive}
                              active
                            />
                          </div>
                        )}

                        <div
                          className="animate-fade-in"
                          style={
                            i > 0 && i === activeIndex && !done
                              ? {
                                  animationDelay: "550ms",
                                  animationFillMode: "both",
                                }
                              : undefined
                          }
                        >
                          <AgentCard
                            entry={entry}
                            agentIndex={i}
                            active={isActive}
                            expanded={expanded}
                            outputLabel={entry.handoff}
                            onSelect={() => {
                              toggleOverride(i, defaultExpanded);
                            }}
                          />
                        </div>

                        {/* Mid-run the stage shows one agent, so name what comes
                            next — otherwise the pipeline reads as a dead end
                            between stages. */}
                        {!done && i === focusIndex && agents[i + 1] && (
                          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-ink-soft">
                            <span className="h-px w-8 bg-border" aria-hidden />
                            <span>
                              next · <span className="text-ink">{agents[i + 1].agent}</span>
                            </span>
                            <span className="h-px w-8 bg-border" aria-hidden />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {(() => {
                const mutationIdx = agents.findIndex((a) => a.id === "mutation");
                const showRetries = mutationIdx >= 0 && activeIndex >= mutationIdx;
                return showRetries ? (
                  <div ref={repairAttemptsRef} className="scroll-mt-6 space-y-3">
                    {runData.status.attempts.error && (
                      <PanelError
                        panel="repair attempts"
                        message={runData.status.attempts.error}
                        onRetry={runData.retry}
                      />
                    )}
                    <RetrySequence model={runData.attempts} />
                  </div>
                ) : null;
              })()}

              <footer className="pb-4 pt-2 text-center text-xs text-ink-soft">
                Run {runData.header.shortRunId} · evidence preserved · proof bundle signed
              </footer>
            </div>

            {done &&
              showRunReport &&
              // A report that never loaded must not render as an empty one —
              // "0 files changed, no trust score" is a claim, and we do not
              // have it. Once a report *has* loaded, a later failed poll shows
              // the stale-but-real report with the error beside it.
              (runData.status.report.error && !runData.status.report.loaded ? (
                <aside className="w-[380px] shrink-0">
                  <PanelError
                    panel="the run report"
                    message={runData.status.report.error}
                    onRetry={runData.retry}
                  />
                </aside>
              ) : (
                <div className="contents">
                  {runData.status.report.error && (
                    <PanelError
                      panel="the latest run report"
                      message={runData.status.report.error}
                      onRetry={runData.retry}
                    />
                  )}
                  <RunReport
                    done={done}
                    agents={agents}
                    activeIndex={activeIndex}
                    report={runData.report}
                  />
                </div>
              ))}
          </div>
        )}
      </main>

      {view === "execution" && (
        <ChatPanel answerer={isLive ? (q) => askChat(runId, q) : undefined} />
      )}
    </div>
  );
}

function SimpleView({ label }: { label: string }) {
  const title = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <div className="flex min-h-[calc(100vh-3rem)] items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Select a repository from the sidebar to view a run.
        </p>
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-primary">{eyebrow}</div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">{title}</h2>
      {description && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p>}
    </div>
  );
}

/** Shown while live view models are in flight, in place of fixture data. */
function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-[1480px] px-6 py-6">
      <div className="flex items-center gap-2.5 text-sm text-ink-soft">
        <span className="h-1.5 w-1.5 animate-soft-pulse rounded-full bg-status-running" />
        Loading run…
      </div>
    </div>
  );
}

/**
 * Shown in place of, or above, a panel whose model failed to load (B-F01).
 *
 * The point is that the user can tell a fetch that failed from a run that
 * genuinely produced nothing. Without this a broken `/report` and a run with no
 * report render identically — the empty model, silently.
 */
function PanelError({
  panel,
  message,
  onRetry,
}: {
  panel: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-status-failed/30 bg-status-failed-bg/40 px-3 py-2 text-xs text-ink"
    >
      <span className="font-medium text-status-failed">Could not load {panel}</span>
      <span className="font-mono text-ink-soft">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="ml-auto rounded-md border border-border px-2 py-0.5 font-medium text-ink transition-colors hover:bg-surface-muted"
      >
        Retry
      </button>
    </div>
  );
}

/** What the "Current Agent" tile reads once nothing is streaming any more. */
const CURRENT_AGENT_BY_STATE: Record<string, string> = {
  running: "Streaming…",
  completed: "Completed",
  failed: "Stopped",
  blocked: "Stopped",
};

function WorkspaceHeader({
  done,
  header,
  lifecycle,
}: {
  done: boolean;
  /** Always supplied by `useRunData` — blank in live mode until the backend answers. */
  header: WorkspaceHeaderModel;
  /** How the backend says this run ended. Drives every label in this header. */
  lifecycle: RunLifecycleView;
}) {
  // Mock mode has no backend status, so `done` alone settles it as completed.
  const state = lifecycle.terminal ? lifecycle.state : done ? "completed" : "running";
  const settled = state !== "running";
  const items = [
    { label: "Repository", value: header.repository, mono: true },
    { label: "Branch", value: header.branch, icon: <GitBranch className="h-3 w-3" />, mono: true },
    { label: "Run", value: header.shortRunId, icon: <Hash className="h-3 w-3" />, mono: true },
    { label: "Current Agent", value: CURRENT_AGENT_BY_STATE[state] ?? "Streaming…" },
    { label: "Retries", value: String(header.retries), icon: <RefreshCcw className="h-3 w-3" /> },
    { label: "Execution Time", value: header.executionTime, icon: <Clock className="h-3 w-3" /> },
  ];
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                state === "completed"
                  ? "bg-status-completed"
                  : state === "failed"
                    ? "bg-status-failed"
                    : state === "blocked"
                      ? "bg-status-draft"
                      : "bg-status-running animate-soft-pulse"
              }`}
            />
            {state === "completed"
              ? "Execution complete"
              : state === "failed"
                ? "Execution stopped"
                : state === "blocked"
                  ? "Execution halted before repair"
                  : "Executing"}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
            {header.repository} <span className="text-ink-soft">·</span>{" "}
            <span className="font-mono text-lg text-ink-soft">{header.branch}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            status={state}
            pulse={!settled}
            label={
              state === "running"
                ? "Status · Running"
                : state === "completed"
                  ? "Status · Completed"
                  : state === "failed"
                    ? "Status · Failed"
                    : "Status · Blocked"
            }
          />
          <StatusBadge
            // `blocked` has its own tone now (B-F05). It used to fall into the
            // draft branch here, painting "a PR awaits review" over a run that
            // never produced one.
            status={state === "failed" || state === "blocked" ? state : "draft"}
            label={`Decision · ${lifecycle.terminal ? lifecycle.decisionLabel : header.decisionLabel}`}
          />
        </div>
      </div>

      {/* Why the run ended, in the backend's words. Only ever rendered when the
          backend supplied a reason — there is no fallback sentence, because a
          composed one would be this UI describing a verdict it did not reach. */}
      {lifecycle.reason && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2.5 ${
            state === "failed"
              ? "border-status-failed/30 bg-status-failed-bg/40"
              : state === "blocked"
                ? "border-status-blocked/30 bg-status-blocked-bg/40"
                : "border-status-draft/30 bg-status-draft-bg/40"
          }`}
        >
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">
            {state === "blocked" ? "Environment" : "Reason"}
          </div>
          <p className="mt-1 text-sm text-ink">{lifecycle.reason}</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-lg border border-border bg-surface-muted/60 px-3 py-2.5"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
              {it.icon}
              {it.label}
            </div>
            <div
              className={`mt-1 truncate text-sm font-semibold text-ink tabular-nums ${it.mono ? "font-mono" : ""}`}
              title={it.value}
            >
              <AnimatedNumber value={it.value} />
            </div>
          </div>
        ))}
      </div>

      <RepositoryIdentity header={header} />
    </section>
  );
}

/**
 * Which repository, at which commit, indexed as what.
 *
 * The backend has published these since the index layer landed and nothing
 * rendered them. `repositoryId` is the key every cross-run store is keyed by, so
 * it is the only thing that makes "this repository has been seen before"
 * checkable rather than asserted — which is exactly the claim A0.5's card makes.
 *
 * Fields are omitted when the backend sends null. A commit the run never
 * observed is not rendered as a dash that implies a value was measured and
 * empty; it simply is not there, and when nothing is known the strip is absent.
 */
function RepositoryIdentity({ header }: { header: WorkspaceHeaderModel }) {
  const entries = [
    { label: "Repository ID", value: header.repositoryId, short: (v: string) => v.slice(0, 12) },
    { label: "HEAD", value: header.headSha, short: (v: string) => v.slice(0, 7) },
    { label: "Index hash", value: header.repositoryHash, short: (v: string) => v.slice(0, 12) },
  ].filter((e): e is { label: string; value: string; short: (v: string) => string } =>
    Boolean(e.value),
  );

  if (entries.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
      {entries.map((e) => (
        <span key={e.label} className="flex items-center gap-1.5 text-[11px]">
          <span className="font-medium uppercase tracking-wider text-ink-soft">{e.label}</span>
          <span className="font-mono text-ink" title={e.value}>
            {e.short(e.value)}
          </span>
        </span>
      ))}
    </div>
  );
}

function ExecutiveSummary({
  agents,
  activeIndex,
  done,
  summary,
  report,
}: {
  agents: LiveAgent[];
  activeIndex: number;
  done: boolean;
  /** Always supplied by `useRunData` — blank in live mode until the backend answers. */
  summary: ExecutiveSummaryModel;
  /** Source of the evidence flags. Absent until the report request resolves. */
  report?: RunReportModel | null;
}) {
  void agents;

  // Decision
  const decision = summary.decision;

  // `done` tracks the journal replay, which advances agent by agent. A run the
  // precheck blocked emits three agents and stops, so the replay never reaches
  // the end and the decision sat at "In progress…" forever on a run that had
  // finished. `blocked` and `failed` are only ever published by a run that is
  // over, so they settle it on their own. `draft` cannot: `run_decision`
  // returns it as the in-flight default too.
  const settled = done || decision === "blocked" || decision === "failed";
  const decisionMeta =
    decision === "merge"
      ? {
          label: "Auto Merge",
          tint: "bg-status-completed-bg/40 border-status-completed/30",
          dot: "bg-status-completed",
          text: "text-status-completed",
        }
      : decision === "failed"
        ? {
            label: "Failed",
            tint: "bg-status-failed-bg/40 border-status-failed/30",
            dot: "bg-status-failed",
            text: "text-status-failed",
          }
        : // A blocked run stopped at the environment precheck. It has no PR of
          // any kind, and falling through to "Draft PR" announced a decision
          // the pipeline never made.
          decision === "blocked"
          ? {
              label: "Environment not prepared",
              tint: "bg-status-blocked-bg/40 border-status-blocked/30",
              dot: "bg-status-blocked",
              text: "text-status-blocked",
            }
          : {
              label: "Draft PR",
              tint: "bg-status-draft-bg/40 border-status-draft/30",
              dot: "bg-status-draft",
              text: "text-status-draft",
            };

  // Reveal threshold per field (agent index)
  type Fact = { label: string; value: ReactNode; show: boolean; mono?: boolean };

  const executionFacts: Fact[] = [
    { label: "Repository", value: summary.repository, show: activeIndex >= 0, mono: true },
    { label: "Runtime", value: done ? summary.runtime : "—", show: done, mono: true },
    { label: "Attempts", value: String(summary.attempts), show: activeIndex >= 7, mono: true },
  ];

  const analysisFacts: Fact[] = [
    { label: "Bug", value: summary.bug, show: activeIndex >= 2 },
    {
      label: "Severity",
      // A severity nobody measured must not wear the red chip — that is the
      // visual claim "we scanned and it was bad". Absence renders muted.
      value:
        summary.severity === "not measured" ? (
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {summary.severity}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-status-failed/30 bg-status-failed-bg/50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-status-failed">
            <span className="h-1.5 w-1.5 rounded-full bg-status-failed" />
            {summary.severity}
          </span>
        ),
      show: activeIndex >= 2,
    },
    { label: "Root Cause", value: summary.rootCause, show: activeIndex >= 4 },
    { label: "Confidence", value: summary.confidence, show: activeIndex >= 4, mono: true },
    {
      label: "Files Affected",
      value: String(summary.filesAffected),
      show: activeIndex >= 5,
      mono: true,
    },
    { label: "Mutation Score", value: summary.mutationScore, show: activeIndex >= 8, mono: true },
  ];

  // The backend decides these. They used to be literals — `ok: true` for
  // "Runtime Reproduced" and "Root Cause Confirmed" regardless of whether
  // either happened, and a permanent "Mutation Validation Failed" cross. On a
  // run blocked at the environment precheck, where A3.5 and A4 never executed,
  // this drew two green ticks claiming evidence that does not exist.
  //
  // `report.evidence` carries the real flags with the backend's own wording,
  // each already matched to its boolean. Until the report arrives there is
  // nothing to show, which is the honest state for "not known yet".
  const evidence = (report?.evidence ?? []).map((flag: { ok: boolean; text: string }) => ({
    ok: flag.ok,
    label: flag.text,
    show: true,
  }));

  const renderFact = (f: Fact) => (
    <div
      key={f.label}
      className={`flex items-baseline justify-between gap-4 border-b border-border/40 pb-3 transition-opacity duration-500 ${
        f.show ? "opacity-100" : "opacity-40"
      }`}
    >
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft">
        {f.label}
      </dt>
      <dd
        className={`truncate text-right text-[14px] font-semibold text-ink tabular-nums ${f.mono ? "font-mono text-[13px]" : ""}`}
      >
        {f.show ? f.value : <span className="text-ink-soft/60">—</span>}
      </dd>
    </div>
  );

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-8 animate-card-in">
      <div className="absolute right-6 top-6 hidden h-24 w-24 rounded-full bg-white/[0.015] blur-2xl sm:block" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
          <span className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            AI Executive Summary
          </span>
          {!done && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-status-running-bg px-2 py-0.5 text-[10px] font-medium text-status-running normal-case tracking-normal">
              <span className="h-1.5 w-1.5 rounded-full bg-status-running animate-soft-pulse" />
              Live
            </span>
          )}
        </div>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          {/* Left: Facts, grouped */}
          <div className="space-y-8">
            <div>
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                <span className="h-px flex-1 bg-border/60" />
                <span>Execution</span>
                <span className="h-px flex-[6] bg-border/60" />
              </div>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-3.5 sm:grid-cols-2">
                {executionFacts.map(renderFact)}
              </dl>
            </div>
            <div>
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                <span className="h-px flex-1 bg-border/60" />
                <span>Analysis</span>
                <span className="h-px flex-[6] bg-border/60" />
              </div>
              <dl className="grid grid-cols-1 gap-x-10 gap-y-3.5 sm:grid-cols-2">
                {analysisFacts.map(renderFact)}
              </dl>
            </div>
          </div>

          {/* Right: Final Decision */}
          <div
            className={`flex flex-col rounded-xl border p-6 transition-all duration-500 ${decisionMeta.tint} ${
              done ? "opacity-100" : "opacity-70"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Final Decision
              </div>
              {done && decision === "draft" && (
                <GitPullRequest className="h-3.5 w-3.5 text-status-draft" strokeWidth={2} />
              )}
            </div>

            <div className="mt-3 inline-flex items-center gap-2.5 self-start">
              <span
                className={`h-2.5 w-2.5 rounded-full ${decisionMeta.dot} ${!settled ? "animate-soft-pulse" : ""}`}
              />
              <span
                className={`font-heading text-[22px] font-bold tracking-tight ${decisionMeta.text}`}
              >
                {settled ? decisionMeta.label : "In progress…"}
              </span>
            </div>

            <div className="mt-6 flex items-baseline justify-between gap-2 border-t border-border/50 pt-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Trust Score
              </span>
              <span className="font-mono text-[28px] font-semibold leading-none tracking-tight text-ink tabular-nums">
                {done ? <AnimatedNumber value={summary.trustScore} duration={500} /> : "—"}
              </span>
            </div>

            <div
              className={`mt-5 transition-opacity duration-500 ${done ? "opacity-100" : "opacity-0"}`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-soft">
                Reason
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink">{summary.decisionReason}</p>
            </div>

            <div className="mt-6 flex flex-wrap gap-1.5">
              {evidence.map((e) => (
                <span
                  key={e.label}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-500 hover:-translate-y-[1px] ${
                    e.show ? "opacity-100" : "opacity-0"
                  } ${
                    e.ok
                      ? "border-status-completed/30 bg-status-completed-bg/40 text-status-completed hover:border-status-completed/50"
                      : "border-status-failed/30 bg-status-failed-bg/40 text-status-failed hover:border-status-failed/50"
                  }`}
                >
                  <span className="font-mono text-[10px]">{e.ok ? "✓" : "✗"}</span>
                  {e.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
