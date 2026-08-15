/**
 * A0.7 — Environment Preflight Board.
 *
 * Everything on this card comes from `state.environment` (A0.7's own report,
 * forwarded verbatim onto the workspace header) or from `environmentProbeError`
 * (set when the probe itself crashed). Nothing here is estimated, animated, or
 * templated from a percentage — a check either ran and says what it found, or
 * it did not run and says "Not measured". See `backend/services/environment_probe.py`
 * for what the backend actually checks.
 */
import { Check, X, AlertTriangle, Copy, HelpCircle } from "lucide-react";
import { useState } from "react";
import type { WorkspaceHeaderModel } from "@/mocks";

type EnvironmentReport = NonNullable<WorkspaceHeaderModel["environment"]>;

/** The seven states a user can actually be shown — never collapsed together. */
type BoardState =
  | "READY"
  | "NOT_PREPARED"
  | "UNSUPPORTED"
  | "NO_MANIFEST"
  | "NO_TEST_RUNNER"
  | "NO_TESTS"
  | "ERROR";

const STATE_LABEL: Record<BoardState, string> = {
  READY: "READY",
  NOT_PREPARED: "NOT PREPARED",
  UNSUPPORTED: "UNSUPPORTED",
  NO_MANIFEST: "NO MANIFEST",
  NO_TEST_RUNNER: "NO TEST RUNNER",
  NO_TESTS: "NO TESTS",
  ERROR: "ERROR",
};

const NEXT_STEP_COPY: Record<BoardState, string> = {
  READY: "Reproduction can proceed.",
  NO_TESTS: "Environment is ready, but reproduction cannot establish a failing test.",
  NOT_PREPARED: "Repair pipeline blocked until the environment is prepared.",
  NO_MANIFEST: "Repair pipeline blocked until the environment is prepared.",
  NO_TEST_RUNNER: "Repair pipeline blocked until the environment is prepared.",
  UNSUPPORTED: "Repository is outside the supported repair environment.",
  ERROR: "The environment could not be determined — the repair pipeline halted pending diagnosis.",
};

function boardState(
  env: EnvironmentReport | null | undefined,
  probeError: boolean,
): BoardState | null {
  if (probeError) return "ERROR";
  if (!env || !env.status) return null;
  if (env.status === "ready") {
    return env.tests_collected === 0 ? "NO_TESTS" : "READY";
  }
  if (env.status === "not_prepared") return "NOT_PREPARED";
  if (env.status === "unsupported") return "UNSUPPORTED";
  if (env.status === "no_manifest") return "NO_MANIFEST";
  if (env.status === "no_test_runner") return "NO_TEST_RUNNER";
  // A status string the frontend does not recognise is itself a fact worth
  // surfacing honestly rather than silently defaulting to a known state.
  return "ERROR";
}

const STATE_TONE: Record<BoardState, string> = {
  READY: "border-status-completed/30 bg-status-completed-bg text-status-completed",
  NO_TESTS: "border-status-completed/30 bg-status-completed-bg text-status-completed",
  NOT_PREPARED: "border-status-failed/30 bg-status-failed-bg text-status-failed",
  NO_MANIFEST: "border-status-failed/30 bg-status-failed-bg text-status-failed",
  NO_TEST_RUNNER: "border-status-failed/30 bg-status-failed-bg text-status-failed",
  UNSUPPORTED: "border-status-failed/30 bg-status-failed-bg text-status-failed",
  ERROR: "border-status-failed/30 bg-status-failed-bg text-status-failed",
};

function CheckRow({
  label,
  ok,
  value,
}: {
  label: string;
  /** `true`/`false` renders a tick/cross, `null` renders "Not measured". */
  ok: boolean | null;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted/40 px-2.5 py-1.5">
      <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      <span
        className={`flex items-center gap-1.5 font-mono text-[11px] font-semibold ${
          ok === null ? "text-ink-soft" : ok ? "text-status-completed" : "text-status-failed"
        }`}
      >
        {ok === null ? (
          <HelpCircle className="h-3 w-3" />
        ) : ok ? (
          <Check className="h-3 w-3" strokeWidth={3} />
        ) : (
          <X className="h-3 w-3" strokeWidth={3} />
        )}
        {value}
      </span>
    </div>
  );
}

type PipelineNodeState = "done" | "blocked" | "skipped";

function PipelineNode({ label, state }: { label: string; state: PipelineNodeState }) {
  const tone =
    state === "done"
      ? "border-status-completed/40 bg-status-completed-bg text-status-completed"
      : state === "blocked"
        ? "border-status-failed/40 bg-status-failed-bg text-status-failed"
        : "border-border bg-surface-muted text-ink-soft opacity-50";
  return (
    <span
      className={`rounded-md border px-2 py-1 text-[10px] font-medium whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  );
}

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be denied by the browser; the command is
          // still visible and selectable as text, so this is not fatal.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[10px]
        font-medium text-ink-soft transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2
        focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label="Copy suggested setup command"
    >
      <Copy className="h-3 w-3" />
      {copied ? "Copied" : "Copy command"}
    </button>
  );
}

export function EnvironmentPreflightBoard({
  environment,
  probeError,
}: {
  environment: WorkspaceHeaderModel["environment"];
  probeError?: boolean;
}) {
  const state = boardState(environment, !!probeError);
  if (!state) return null;

  const env = environment ?? null;
  const blocking = state !== "READY" && state !== "NO_TESTS";
  const manifest = env?.manifests?.[0]?.path ?? null;
  const missing = env?.missing_imports ?? [];

  // Pipeline: only phases the probe actually reached are marked done/blocked;
  // anything after the point of failure never ran, so it is drawn as skipped
  // rather than a synthetic "pending" state.
  const manifestNode: PipelineNodeState = state === "NO_MANIFEST" ? "blocked" : "done";
  const runnerLangNode: PipelineNodeState =
    state === "NO_MANIFEST" ? "skipped" : state === "UNSUPPORTED" ? "blocked" : "done";
  const runnerCheckNode: PipelineNodeState =
    state === "NO_MANIFEST" || state === "UNSUPPORTED"
      ? "skipped"
      : env?.test_runner_available === false
        ? "blocked"
        : env?.test_runner_available === true
          ? "done"
          : "skipped";
  const collectionNode: PipelineNodeState =
    runnerCheckNode !== "done" ? "skipped" : env?.tests_collected != null ? "done" : "blocked";
  const verdictNode: PipelineNodeState =
    state === "ERROR" ? "blocked" : blocking ? "blocked" : "done";

  return (
    <section
      role="status"
      aria-label={`Environment preflight: ${STATE_LABEL[state]}`}
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Environment Preflight</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATE_TONE[state]}`}
        >
          {blocking && <AlertTriangle className="h-3 w-3" />}
          {STATE_LABEL[state]}
        </span>
      </div>

      {/* Step 7 — the pipeline, drawn only from what actually happened. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-hidden>
        <PipelineNode label="Detect" state="done" />
        <span className="text-ink-soft/50">→</span>
        <PipelineNode label="Manifest" state={manifestNode} />
        <span className="text-ink-soft/50">→</span>
        <PipelineNode label="Test Runner" state={runnerLangNode} />
        <span className="text-ink-soft/50">→</span>
        <PipelineNode label="Runner Check" state={runnerCheckNode} />
        <span className="text-ink-soft/50">→</span>
        <PipelineNode label="Test Collection" state={collectionNode} />
        <span className="text-ink-soft/50">→</span>
        <PipelineNode label="Verdict" state={verdictNode} />
      </div>

      {/* Step 4 — the checklist. */}
      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        <CheckRow
          label="Language"
          ok={env?.language ? true : null}
          value={
            env?.language ? env.language[0].toUpperCase() + env.language.slice(1) : "Not measured"
          }
        />
        <CheckRow
          label="Manifest"
          ok={manifest ? true : state === "NO_MANIFEST" ? false : null}
          value={manifest ?? (state === "NO_MANIFEST" ? "Unavailable" : "Not measured")}
        />
        <CheckRow
          label="Test Runner"
          ok={env?.test_runner ? true : state === "NO_TEST_RUNNER" ? false : null}
          value={env?.test_runner ?? "Not measured"}
        />
        <CheckRow
          label="Runner Availability"
          ok={env?.test_runner ? !!env.test_runner_available : null}
          value={
            !env?.test_runner
              ? "Not measured"
              : env.test_runner_available
                ? "Available"
                : "Not available"
          }
        />
        <CheckRow
          label="Test Collection"
          ok={env?.tests_collected != null ? env.tests_collected > 0 : null}
          value={
            env?.tests_collected == null
              ? "Not measured"
              : env.tests_collected === 0
                ? "None detected"
                : `${env.tests_collected} collected`
          }
        />
        <CheckRow
          label="Environment"
          ok={state === "READY" || state === "NO_TESTS"}
          value={STATE_LABEL[state]}
        />
      </div>

      {/* Step 5 — the blocked experience. */}
      {state === "ERROR" ? (
        <div className="mt-4 rounded-md border border-status-failed/30 bg-status-failed-bg px-3 py-2.5 text-[12px] text-status-failed">
          The environment precheck did not reach a verdict — it errored before it could classify
          this repository. See the run's error log for detail.
        </div>
      ) : (
        blocking &&
        env?.reason && (
          <div className="mt-4 rounded-md border border-status-failed/30 bg-status-failed-bg px-3 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-status-failed">
              Reason
            </div>
            <div className="mt-0.5 text-[12px] text-status-failed/90">{env.reason}</div>
            {missing.length > 0 && (
              <div className="mt-1.5 font-mono text-[10px] text-status-failed/80">
                Missing: {missing.join(", ")}
              </div>
            )}
            {env.suggested_command && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-status-failed">
                    Suggested setup
                  </div>
                  <code className="mt-0.5 block truncate rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink">
                    {env.suggested_command}
                  </code>
                </div>
                <CopyCommandButton command={env.suggested_command} />
              </div>
            )}
          </div>
        )
      )}

      {/* Step 6 — the no-test experience. Ready is ready; missing tests is a
          separate, non-failing fact. */}
      {state === "NO_TESTS" && (
        <div className="mt-4 rounded-md border border-status-retry/30 bg-status-retry-bg px-3 py-2.5 text-[12px] text-status-retry">
          Reproduction cannot establish a failing test.
        </div>
      )}

      {/* Step 8 — the execution relationship. */}
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[11px] text-ink-soft">
        <span className="font-medium text-ink">Environment decision</span>
        <span className="text-ink-soft/50">→</span>
        <span>{NEXT_STEP_COPY[state]}</span>
      </div>
    </section>
  );
}
