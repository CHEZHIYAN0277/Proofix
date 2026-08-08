/**
 * `<ChatDock>` — BOTTOM, persistent (blueprint §4).
 *
 * Wired to `POST /api/runs/{id}/chat`, which answers from run state.
 *
 * The rule that matters (§Phase 10): **backend-only answers.** A failed call
 * says so and never substitutes a guess — no client-side fallback, no "I think
 * the run…", no cached approximation. An assistant that invents an answer about
 * an autonomous repair is worse than one that says the request failed.
 */

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/design/components/Button";
import { TextInput } from "@/design/components/Input";
import { Reveal } from "@/design/primitives/Reveal";
import { ErrorState } from "@/design/states/ErrorState";
import { glass } from "@/design/tokens/elevation";
import { cn } from "@/lib/utils";
import { sendChat } from "@/lib/v2/queries";
import { useRunId } from "../RunProvider";

interface Turn {
  id: string;
  question: string;
  /** `null` while the request is open. */
  answer: string | null;
  error: string | null;
}

export function ChatDock() {
  const runId = useRunId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (question: string) => sendChat(runId, question),
  });

  const ask = async (question: string) => {
    const id = `${Date.now()}`;
    setTurns((prev) => [...prev, { id, question, answer: null, error: null }]);
    setDraft("");
    setOpen(true);

    try {
      const { answer } = await mutation.mutateAsync(question);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, answer } : t)));
    } catch (error) {
      // The failure is reported as a failure. Nothing is substituted.
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, error: (error as Error).message } : t)),
      );
    }
  };

  return (
    <div className={cn(glass("chat-dock"), "shrink-0 border-x-0 border-b-0 rounded-none")}>
      {open && turns.length > 0 && (
        <div className="max-h-56 overflow-y-auto px-5 py-3">
          <ol className="flex flex-col gap-3">
            {turns.map((turn) => (
              <li key={turn.id} className="flex flex-col gap-1.5">
                <p className="type-body-sm text-ink-soft">{turn.question}</p>

                {turn.error ? (
                  <ErrorState
                    title="The chat request failed"
                    detail={turn.error}
                    source="POST /api/runs/{id}/chat"
                    size="sm"
                  />
                ) : turn.answer === null ? (
                  <p className="type-body-sm text-ink-soft" aria-live="polite">
                    Asking…
                  </p>
                ) : (
                  <Reveal class="event" token="base" from="up">
                    <p className="type-body whitespace-pre-wrap text-ink">{turn.answer}</p>
                  </Reveal>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <form
        className="flex items-center gap-2 px-5 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          const question = draft.trim();
          if (question) void ask(question);
        }}
      >
        <TextInput
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Ask about this run"
          aria-label="Ask about this run"
          className="h-8 flex-1"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={<CornerDownLeft />}
          loading={mutation.isPending}
          disabled={draft.trim().length === 0}
        >
          Ask
        </Button>
        {turns.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={open ? <ChevronDown /> : <ChevronUp />}
            aria-label={open ? "Collapse chat history" : "Expand chat history"}
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          />
        )}
      </form>
    </div>
  );
}
