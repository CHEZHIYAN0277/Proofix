/**
 * Frame normalisation (blueprint §12, §13).
 *
 * The socket carries four shapes on one channel: agent events, lifecycle
 * events, keep-alive pings, and a legacy terminal frame the backend sends when
 * a lifecycle event never landed (`ws.py:162`). They are told apart by shape —
 * only lifecycle and ping frames carry `type`.
 *
 * Everything downstream sees one discriminated union, so the store never
 * parses a payload and no component ever sees a raw socket message.
 */

import type {
  AgentEventStatus,
  AgentStatusEvent,
  PRType,
  RunLifecycleEvent,
  RunLifecycleType,
} from "../types";

export type RunFrame =
  | {
      kind: "agent";
      /** Backend `agent_id`, e.g. `A5.5`. */
      agentId: string;
      status: AgentEventStatus;
      message: string;
      /** Epoch ms. */
      at: number;
      payload: Record<string, unknown> | null;
      sequence: number;
    }
  | {
      kind: "lifecycle";
      type: RunLifecycleType;
      decision: PRType | null;
      decisionLabel: string;
      reason: string | null;
      at: number;
      sequence: number;
    };

/**
 * Backend timestamps are naive UTC (`datetime.utcnow()`), so they arrive
 * without a zone designator. Parsing them as local time shifts every event by
 * the viewer's offset — which silently reorders the timeline against
 * client-side clocks and makes elapsed counters wrong.
 */
export function parseBackendTimestamp(raw: string): number {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  const value = Date.parse(hasZone ? raw : `${raw}Z`);
  return Number.isNaN(value) ? Date.now() : value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Normalise one socket message or REST event.
 *
 * Returns `null` for pings, unparseable frames, and the legacy terminal frame
 * — the last of which carries a run status rather than a decision, so it
 * cannot honestly populate `decision`. The connection layer handles it
 * separately (see `connection.ts`).
 */
export function normalizeFrame(raw: unknown): RunFrame | null {
  if (!isRecord(raw)) return null;

  // Lifecycle and ping frames are the only ones carrying `type`.
  if (typeof raw.type === "string") {
    if (raw.type === "ping") return null;
    if (
      raw.type === "run.started" ||
      raw.type === "run.completed" ||
      raw.type === "run.failed" ||
      raw.type === "run.blocked"
    ) {
      // The legacy fallback shares the `run.completed` name but has no
      // `sequence`. Treating it as authoritative would publish a decision the
      // backend never made.
      if (raw.sequence === undefined) return null;
      const event = raw as unknown as RunLifecycleEvent;
      return {
        kind: "lifecycle",
        type: event.type,
        decision: event.decision ?? null,
        decisionLabel: event.decision_label ?? "",
        reason: event.reason ?? null,
        at: parseBackendTimestamp(event.timestamp),
        sequence: event.sequence,
      };
    }
    return null;
  }

  if (typeof raw.agent_id !== "string" || typeof raw.status !== "string") return null;

  const event = raw as unknown as AgentStatusEvent;
  return {
    kind: "agent",
    agentId: event.agent_id,
    status: event.status,
    message: event.message ?? "",
    at: parseBackendTimestamp(event.timestamp),
    payload: event.payload ?? null,
    sequence: event.sequence ?? 0,
  };
}

/** Whether a raw frame is the legacy terminal fallback (`ws.py:162`). */
export function isLegacyTerminalFrame(
  raw: unknown,
): raw is { type: "run.completed"; status: string } {
  return (
    isRecord(raw) &&
    raw.type === "run.completed" &&
    raw.sequence === undefined &&
    typeof raw.status === "string"
  );
}

/**
 * Stable identity for deduplication.
 *
 * The socket replays history before going live and the backend publishes to
 * both Redis pub/sub and the in-process broadcaster, so the same frame can
 * arrive more than once. `sequence` is monotonic per run and shared across both
 * kinds, but agent and lifecycle frames can carry the same number, so the kind
 * is part of the key.
 */
export function frameKey(frame: RunFrame): string {
  return frame.kind === "agent"
    ? `a:${frame.sequence}:${frame.agentId}:${frame.status}`
    : `l:${frame.sequence}:${frame.type}`;
}
