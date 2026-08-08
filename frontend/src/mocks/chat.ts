import { AGENTS } from "@/components/proofix/data";

export const MOCK_CHAT_SUGGESTIONS = [
  "Why validation failed?",
  "Show blast radius",
  "Root cause?",
  "Why Draft PR?",
];

/**
 * Default in-browser answerer used until the backend chat endpoint is wired.
 * Replace by passing a custom `answerer` prop to <ChatPanel /> that calls
 * `apiFetch(ENDPOINTS.runChat(runId), { method: "POST", json: { q } })`.
 */
export function mockAnswerer(q: string): string {
  const s = q.toLowerCase();
  if (s.includes("validation") || s.includes("fail")) {
    const m = AGENTS.find((a) => a.id === "mutation")!;
    return `Mutation testing failed. ${m.metrics?.[3].label} = ${m.metrics?.[3].value} out of ${m.metrics?.[1].value} mutants. Score 0.81 against threshold 0.92 — the candidate patch did not kill enough mutants, so the repair was rejected and a retry was initiated.`;
  }
  if (s.includes("blast") || s.includes("impact") || s.includes("affect")) {
    const b = AGENTS.find((a) => a.id === "blast")!;
    return `Affected modules:\n• ${b.pills?.join("\n• ")}\n\n2 direct callers, 3 indirect, 1 shared utility (utils/jwt.py).`;
  }
  if (s.includes("root") || s.includes("cause") || s.includes("why")) {
    if (s.includes("draft") || s.includes("merge")) {
      return `Trust composite was 0.83, below the 0.90 auto-merge threshold. Correctness scored 0.78 and fidelity 0.74 — both flagged the repair as not behaviourally equivalent. Because the change touches authentication logic, ProoFix routed to a Draft PR for human review.`;
    }
    return `Root cause: missing expiry comparison in validate_token() at auth/token.py:142. The check expired_at < now was never evaluated, so expired tokens were accepted as valid.`;
  }
  if (s.includes("retry") || s.includes("attempt")) {
    return `3 patch attempts were generated. All three were rejected by mutation testing. The planner exhausted its retry budget and handed off to the Mergeability Router.`;
  }
  if (s.includes("file") || s.includes("change")) {
    return `Files modified by the candidate patch: auth/token.py (+9 −3), api/session.py (+5 −3). The patch followed the Repair DAG: token.py → session.py → tests/test_auth.py.`;
  }
  return `I can answer using the current run's evidence — try: "Why did validation fail?", "Show blast radius", or "Why a Draft PR?".`;
}
