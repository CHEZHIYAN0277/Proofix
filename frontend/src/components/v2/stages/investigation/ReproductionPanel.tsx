/**
 * Runtime reproduction — A3.5's evidence that the bug is real.
 *
 * The command, the failing test, the exception and the captured traceback,
 * exactly as the pipeline recorded them. A3.5's payload is explicit that it
 * carries no invented fallbacks: "showing a command the run never issued, or
 * an assertion it never raised, makes the card fiction". The `—` it uses for
 * those cases is normalised to an absence here.
 *
 * The status distinction matters and is preserved: `CONFIRMED` means the
 * failure was reproduced, while `INFRA_ERROR` means the harness could not run
 * at all — which is not a reproduction, and is why the run routes to a draft.
 */

import { useQuery } from "@tanstack/react-query";

import { CodeBlock } from "@/design/components/CodeBlock";
import { DataBoundary } from "@/design/primitives/DataBoundary";
import { StatusPill } from "@/design/primitives/StatusDot";
import { Eyebrow, KeyValue } from "@/design/primitives/atoms";
import { EmptyState } from "@/design/states/EmptyState";
import { SkeletonText } from "@/design/states/Skeleton";
import { orNull } from "@/lib/v2/absence";
import { agentsQuery } from "@/lib/v2/queries";
import type { AgentEntry } from "@/lib/v2/types";
import { useRunId } from "../../RunProvider";

const REPRODUCE_AGENT_ID = "A3.5";

interface ReproduceData {
  command?: string;
  tests?: { name: string; result: string }[];
  failure?: {
    name?: string;
    assertion?: string;
    expected?: string;
    actual?: string;
    stack?: string[];
  };
  successMessage?: string;
}

export function ReproductionPanel() {
  const runId = useRunId();
  const { data, isLoading } = useQuery(agentsQuery(runId));

  if (isLoading) return <SkeletonText lines={4} label="Loading reproduction evidence" />;

  const agent = (data ?? []).find((e: AgentEntry) => e.agentId === REPRODUCE_AGENT_ID);
  const viz = (agent?.visualization as { data?: ReproduceData } | undefined)?.data;

  return (
    <DataBoundary
      value={viz}
      whenMissing="waiting"
      reason="A3.5 has not published a reproduction attempt yet"
    >
      {(reproduction) => {
        // The message states the outcome in the backend's own words. A
        // reproduction that did not confirm says so rather than being rendered
        // as a success with empty fields.
        const confirmed = reproduction.successMessage?.startsWith("Failure reproduced");

        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={confirmed ? "completed" : "retry"} size="sm">
                {confirmed ? "Reproduced" : "Not reproduced"}
              </StatusPill>
              <span className="type-body-sm text-ink-soft">{reproduction.successMessage}</span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-1">
                <KeyValue
                  label="Failing test"
                  value={orNull(reproduction.failure?.name)}
                  whenMissing="unavailable"
                  reason="A3.5 recorded no failing test"
                  mono
                />
                <KeyValue
                  label="Exception"
                  value={orNull(reproduction.failure?.actual)}
                  whenMissing="unavailable"
                  reason="A3.5 recorded no exception type"
                  mono
                />
                <KeyValue
                  label="Assertion"
                  value={orNull(reproduction.failure?.assertion)}
                  whenMissing="unavailable"
                  reason="A3.5 recorded no assertion message"
                />
                <KeyValue
                  label="Expected"
                  value={orNull(reproduction.failure?.expected)}
                  whenMissing="unavailable"
                  reason="A3.5 recorded no expected outcome"
                  mono
                />
              </div>

              <div>
                <Eyebrow className="mb-2">Tests</Eyebrow>
                <DataBoundary
                  value={reproduction.tests?.length ? reproduction.tests : null}
                  whenMissing="unavailable"
                  emptyIsMissing
                  reason="A3.5 recorded no test results"
                >
                  {(tests) => (
                    <ul className="flex flex-col gap-1">
                      {tests.map((test, index) => (
                        <li
                          key={`${test.name}:${index}`}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <span className="type-mono-sm min-w-0 truncate text-ink">
                            {test.name}
                          </span>
                          <span
                            className="type-caption shrink-0"
                            style={{
                              color:
                                test.result === "FAIL"
                                  ? "var(--status-failed)"
                                  : "var(--status-completed)",
                            }}
                          >
                            {test.result}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </DataBoundary>
              </div>
            </div>

            <div>
              <Eyebrow className="mb-2">Re-execution command</Eyebrow>
              <DataBoundary
                value={orNull(reproduction.command)}
                whenMissing="unavailable"
                reason="A3.5 built no targeted re-execution command"
              >
                {(command) => (
                  <CodeBlock
                    code={command}
                    language="shell"
                    showLineNumbers={false}
                    maxHeight={80}
                  />
                )}
              </DataBoundary>
            </div>

            <div>
              <Eyebrow className="mb-2">Captured traceback</Eyebrow>
              <DataBoundary
                value={reproduction.failure?.stack?.length ? reproduction.failure.stack : null}
                whenMissing="unavailable"
                emptyIsMissing
                reason="A3.5 captured no traceback for this failure"
                fallback={
                  <EmptyState
                    title="No traceback captured"
                    description="The harness produced no stack for this attempt."
                    size="sm"
                  />
                }
              >
                {(stack) => (
                  <CodeBlock
                    code={stack.join("\n")}
                    language="text"
                    showLineNumbers={false}
                    maxHeight={200}
                  />
                )}
              </DataBoundary>
            </div>
          </div>
        );
      }}
    </DataBoundary>
  );
}
