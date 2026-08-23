import { useState, useRef, useEffect, type RefObject } from "react";
import { ArrowUp, AudioLines } from "lucide-react";
import { MOCK_CHAT_SUGGESTIONS, mockAnswerer } from "@/mocks";
import { DATA_SOURCE } from "@/lib/api";

const isLive = DATA_SOURCE === "api";

/**
 * Suggestion chips for a real run.
 */
const LIVE_CHAT_SUGGESTIONS = [
  "What did the agents find?",
  "Show the root cause",
  "Which files changed?",
  "How was the fix validated?",
];

type Mode = "idle" | "hover";

export function ChatPanel({
  suggestions = isLive ? LIVE_CHAT_SUGGESTIONS : MOCK_CHAT_SUGGESTIONS,
  answerer = mockAnswerer,
  anchorRef,
}: {
  /** Suggestion chips. Override per-run from the backend if desired. */
  suggestions?: string[];
  /** Resolver for user questions. Wire to `runService.askChat(runId, q)` once the backend is live. */
  answerer?: (q: string) => string | Promise<string>;
  /**
   * The content column this bar should track. Its measured viewport rect
   * (left + width) drives the fixed bar's position, so the composer stays
   * aligned to the real content column — sidebar collapsed or not, report
   * panel open or not — instead of guessing pixel offsets per breakpoint.
   */
  anchorRef?: RefObject<HTMLDivElement | null>;
} = {}) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [bounds, setBounds] = useState<{ left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = anchorRef?.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBounds({ left: r.left, width: r.width });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [anchorRef]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setInput("");
    setMode("idle");
    await Promise.resolve(answerer(q));
  };

  const expanded = mode === "hover";

  return (
    <div
      data-chat-panel="true"
      className={`pointer-events-none fixed bottom-0 z-30 px-4 pb-4 sm:px-6 ${
        bounds ? "" : "left-0 right-0"
      }`}
      style={bounds ? { left: bounds.left, width: bounds.width } : undefined}
    >
      <section
        onMouseEnter={() => setMode("hover")}
        onMouseLeave={() => setMode("idle")}
        className="pointer-events-auto mx-auto w-full max-w-2xl overflow-hidden rounded-[18px] border border-border bg-surface/95 backdrop-blur shadow-[0_16px_40px_-16px_rgba(15,23,42,0.28)] transition-all duration-[250ms]"
      >
        {/* Expanded content (hover: initial greeting & suggestion chips) */}
        <div
          className={`grid transition-all duration-[250ms] ease-out ${
            expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="px-4 pt-3 pb-2">
              <p className="mb-2 text-[13px] text-ink-soft">
                I'm reading the current evidence for this run. Ask me anything about what the agents
                found.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-primary/30 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Prompt bar (always visible) */}
        <div className="flex items-end gap-1.5 px-2 py-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex min-h-[36px] flex-1 items-center gap-1.5 rounded-full bg-surface-muted/60 pl-3.5 pr-1 transition"
            onClick={() => {
              inputRef.current?.focus();
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this run..."
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-soft focus:outline-none"
            />
            {input.trim() ? (
              <button
                type="submit"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:brightness-110"
                aria-label="Send"
              >
                <ArrowUp className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
              </button>
            ) : (
              <button
                type="button"
                title="Voice input isn't available yet"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:brightness-110"
                aria-label="Voice input"
              >
                <AudioLines className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
              </button>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
