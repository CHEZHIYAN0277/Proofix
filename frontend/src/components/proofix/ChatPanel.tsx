import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { ArrowUp, AudioLines } from "lucide-react";
import { MOCK_CHAT_SUGGESTIONS, mockAnswerer } from "@/mocks";
import { DATA_SOURCE } from "@/lib/api";
import { transcribeAudio } from "@/lib/speechService";

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

/** Internal voice-recording lifecycle — drives the mic button tooltip only. */
type VoiceState = "idle" | "recording" | "transcribing";

/** Maximum recording duration before we auto-stop (Sarvam REST limit: 30 s). */
const MAX_RECORDING_MS = 29_000;

/** Prefer webm/opus; fall back to any supported type. */
function preferredMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
    "",
  ];
  for (const type of candidates) {
    if (!type || MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

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

  // ── Voice state ──────────────────────────────────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Anchor tracking (unchanged) ──────────────────────────────────────
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

  // ── Stop mic tracks and clear refs ──────────────────────────────────
  const stopMicrophone = useCallback(() => {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, [stopMicrophone]);

  // ── Existing send (unchanged) ────────────────────────────────────────
  const send = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setInput("");
    setMode("idle");
    await Promise.resolve(answerer(q));
  };

  // ── Submit transcript through the existing send() path ───────────────
  const submitTranscript = useCallback(
    async (blob: Blob) => {
      setVoiceState("transcribing");
      setVoiceError(null);
      try {
        const transcript = await transcribeAudio(blob);
        // Feed the transcript into the existing send() — identical to typing.
        await send(transcript);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Voice input failed — try again";
        setVoiceError(msg);
        console.error("[ChatPanel] STT error:", err);
      } finally {
        setVoiceState("idle");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answerer],
  );

  // ── Mic button handler ───────────────────────────────────────────────
  const handleMicClick = useCallback(async () => {
    // Guard: do not interrupt a transcription in progress
    if (voiceState === "transcribing") return;

    // SECOND CLICK — stop recording
    if (voiceState === "recording") {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        // onstop will fire, collect chunks, and call submitTranscript
        recorder.stop();
      }
      return;
    }

    // FIRST CLICK — start recording
    setVoiceError(null);

    // Browser support guard
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Your browser does not support voice input.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access the microphone.";
      setVoiceError(msg);
      console.error("[ChatPanel] Mic permission error:", err);
      return;
    }

    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      stopMicrophone();
      const chunks = audioChunksRef.current;
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      if (blob.size === 0) {
        setVoiceError("No audio was recorded. Please try again.");
        setVoiceState("idle");
        return;
      }
      void submitTranscript(blob);
    };

    recorder.start();
    setVoiceState("recording");

    // Auto-stop at MAX_RECORDING_MS to stay within Sarvam's REST limit
    autoStopTimerRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
    }, MAX_RECORDING_MS);
  }, [voiceState, stopMicrophone, submitTranscript]);

  // ── Tooltip text for the mic button (no visual change) ───────────────
  const micTitle =
    voiceError
      ? voiceError
      : voiceState === "recording"
        ? "Recording… click to stop"
        : voiceState === "transcribing"
          ? "Transcribing…"
          : "Voice input";

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
                title={micTitle}
                aria-label={micTitle}
                disabled={voiceState === "transcribing"}
                onClick={() => void handleMicClick()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:brightness-110"
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
