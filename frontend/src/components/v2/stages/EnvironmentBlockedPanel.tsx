/**
 * The intentional state for a run the environment precheck stopped.
 *
 * This exists because the alternative was worse than nothing. A repository
 * whose dependencies are not installed used to produce seven completed stages,
 * a blast radius of zero files, "Generated 0 patches from 0 plans" four times,
 * and four zeroed axis scores — a composite that read as "we analysed your
 * repository and it scored badly", when the truth was "we could not run your
 * test suite". Every individual statement was true and the whole was a lie.
 *
 * Every line below is a field on the backend's `EnvironmentReport`, rendered
 * verbatim. `reason` in particular is the probe's own sentence, not a template
 * this component fills in — the same convention root-cause summaries follow.
 *
 * **Nothing here executes `suggested_command`.** It is shown for a person to
 * run. Installing from a cloned repository runs that repository's build hooks
 * on the host, and the pipeline's subprocesses are not sandboxed.
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Check } from "lucide-react";
import { useState } from "react";

import { DataBoundary } from "@/design/primitives/DataBoundary";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { cn } from "@/lib/utils";
import { runQuery } from "@/lib/v2/queries";
import { useRunId } from "../RunProvider";

interface DetectedManifest {
  path: string;
  kind: string;
  language: string;
}

export interface EnvironmentReport {
  status: "ready" | "not_prepared" | "no_test_runner" | "unsupported" | "no_manifest";
  language: string | null;
  manifests: DetectedManifest[];
  test_runner: string | null;
  test_runner_available: boolean;
  missing_imports: string[];
  reason: string;
  suggested_command: string | null;
  blocking: boolean;
}

/** The run header carries the stored report once A0.7 has run. */
interface RunWithEnvironment {
  environment?: EnvironmentReport | null;
}

export function EnvironmentBlockedPanel() {
  const runId = useRunId();
  const { data } = useQuery(runQuery(runId));
  const report = (data as RunWithEnvironment | undefined)?.environment ?? null;

  return (
    <DataBoundary
      value={report}
      whenMissing="unavailable"
      reason="The environment precheck published no report for this run"
    >
      {(env) => <EnvironmentReportBody env={env} />}
    </DataBoundary>
  );
}

function EnvironmentReportBody({ env }: { env: EnvironmentReport }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!env.suggested_command) return;
    try {
      await navigator.clipboard.writeText(env.suggested_command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The command
      // is selectable text either way, so this is not worth an error state.
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-card border p-5"
      style={{
        borderColor: "color-mix(in srgb, var(--status-retry) 40%, transparent)",
        backgroundColor: "var(--status-retry-bg)",
      }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          aria-hidden
          className="mt-0.5 size-5 shrink-0"
          style={{ color: "var(--status-retry)" }}
          strokeWidth={2}
        />
        <div className="min-w-0">
          <p className="type-title-3 text-ink">Environment not prepared</p>
          {/* The probe's own sentence. */}
          <p className="type-body-sm mt-1 text-ink-soft">{env.reason}</p>
        </div>
      </div>

      <dl className="flex flex-col gap-1">
        <KeyValue
          label="Detected"
          value={
            env.language
              ? `${env.language} · ${env.manifests.map((m) => m.kind).join(", ") || "no manifest"}`
              : null
          }
          whenMissing="unavailable"
          reason="No dependency manifest was found"
          mono
        />
        <KeyValue
          label="Test runner"
          value={
            env.test_runner
              ? `${env.test_runner} — ${env.test_runner_available ? "available" : "not importable"}`
              : null
          }
          whenMissing="unavailable"
          reason="ProoFix drives no test runner for this project type"
          mono
        />
        <KeyValue
          label="Missing"
          value={env.missing_imports.length > 0 ? env.missing_imports.join(", ") : null}
          whenMissing="unavailable"
          reason="No specific missing imports were identified"
          mono
        />
      </dl>

      {env.suggested_command && (
        <div>
          <Eyebrow className="mb-1.5">To prepare this repository</Eyebrow>
          <div className="flex items-center gap-2">
            <code className="type-mono-sm min-w-0 flex-1 truncate rounded-xs border border-border bg-surface px-2.5 py-1.5 text-ink">
              {env.suggested_command}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "type-caption inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5 text-ink-soft transition-colors hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
              )}
              aria-label="Copy the suggested command"
            >
              {copied ? (
                <Check aria-hidden className="size-3" strokeWidth={2} />
              ) : (
                <Copy aria-hidden className="size-3" strokeWidth={2} />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="type-caption mt-1.5 text-ink-soft">
            ProoFix does not install dependencies. Prepare the environment, then start a new run.
          </p>
        </div>
      )}
    </div>
  );
}
