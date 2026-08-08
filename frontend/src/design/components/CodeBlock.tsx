/**
 * Code block (blueprint §3.6).
 *
 * Line numbers optional, copy button, wrap toggle, and a diff variant with
 * add/remove gutters. **Never a text dump.**
 *
 * Syntax highlighting arrives with Shiki in Phase 6. Rather than pull a
 * highlighter into the base bundle now, the component takes an optional
 * `renderLine` — Phase 6 supplies a Shiki-backed renderer and nothing else
 * about the component changes. Unhighlighted code still renders correctly,
 * with the gutters, wrapping and copy behaviour already in place.
 */

import { Check, Copy, WrapText } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "./Button";

export type DiffMarker = "add" | "remove" | "context";

export interface CodeLine {
  content: string;
  /** Diff gutter. `context` (default) renders untinted. */
  marker?: DiffMarker;
  /**
   * Line number in the original file. Defaults to the array index + 1.
   *
   * `null` suppresses it — a diff's `@@` separator numbers no line in either
   * file, and printing the index there would be a number the file does not
   * have.
   */
  number?: number | null;
  /**
   * Line number in the *post-patch* file, for the diff variant.
   *
   * Supplying it on any line switches the gutter to two columns, before and
   * after. That is not decoration: a diff numbers two different files, and a
   * single column has to keep silently switching between them — a removed line
   * showing `4` and the next line showing `4` mean different files, and the
   * reader has no way to tell. Two columns state which file each number is in.
   */
  numberAfter?: number | null;
}

export interface CodeBlockProps {
  /** Raw source, split on newlines. Ignored when `lines` is supplied. */
  code?: string;
  /** Pre-parsed lines — used by the diff variant. */
  lines?: CodeLine[];
  language?: string;
  /** File path or title shown in the header. Always mono. */
  filename?: string;
  showLineNumbers?: boolean;
  /** Diff variant: renders the +/− gutter and tints changed lines. */
  diff?: boolean;
  defaultWrap?: boolean;
  maxHeight?: number | string;
  /** Phase 6 hook: return highlighted nodes for one line. */
  renderLine?: (line: CodeLine, index: number) => ReactNode;
  className?: string;
}

const MARKER_SIGN: Record<DiffMarker, string> = { add: "+", remove: "−", context: " " };

/**
 * What a screen reader hears in place of the gutter and the +/− sign.
 *
 * Terse on purpose: an unchanged line says only its number, so the two that
 * matter stand out in a long read-through.
 */
function announce(line: CodeLine, marker: DiffMarker, before: number | string): string {
  // The `@@` separator numbers no line in either file.
  if (line.number === null && line.numberAfter == null) return "Diff hunk: ";
  if (marker === "add") return `Added line ${line.numberAfter ?? ""}: `;
  if (marker === "remove") return `Removed line ${before}: `;
  return `Line ${line.numberAfter ?? before}: `;
}

const MARKER_STYLE: Record<DiffMarker, { bg?: string; fg: string }> = {
  add: {
    bg: "color-mix(in srgb, var(--status-completed) 12%, transparent)",
    fg: "var(--status-completed)",
  },
  remove: {
    bg: "color-mix(in srgb, var(--status-failed) 12%, transparent)",
    fg: "var(--status-failed)",
  },
  context: { fg: "var(--ink-soft)" },
};

export function CodeBlock({
  code,
  lines,
  language,
  filename,
  showLineNumbers = true,
  diff = false,
  defaultWrap = false,
  maxHeight = 420,
  renderLine,
  className,
}: CodeBlockProps) {
  const [wrap, setWrap] = useState(defaultWrap);
  const [copied, setCopied] = useState(false);

  const resolved = useMemo<CodeLine[]>(() => {
    if (lines) return lines;
    return (code ?? "").split("\n").map((content) => ({ content }));
  }, [lines, code]);

  const plainText = useMemo(() => resolved.map((l) => l.content).join("\n"), [resolved]);

  // Two gutter columns as soon as any line carries a post-patch number. A
  // caller that supplies only `number` keeps the single column it had.
  const dualGutter = useMemo(
    () => diff && resolved.some((l) => l.numberAfter !== undefined),
    [diff, resolved],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is permission-gated; failing silently is better than a
      // toast that claims a copy that did not happen.
      setCopied(false);
    }
  };

  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-surface", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          {filename && <span className="type-mono-sm truncate text-ink">{filename}</span>}
          {language && <span className="type-caption text-ink-soft">{language}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<WrapText />}
            aria-label={wrap ? "Disable wrapping" : "Enable wrapping"}
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? <Check /> : <Copy />}
            aria-label={copied ? "Copied" : "Copy code"}
            onClick={copy}
          />
        </div>
      </div>

      <div className="overflow-auto" style={{ maxHeight }}>
        <pre className={cn("type-mono-sm py-2", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
          <code>
            {resolved.map((line, i) => {
              const marker = line.marker ?? "context";
              const style = MARKER_STYLE[marker];
              const before = line.number === null ? "" : (line.number ?? i + 1);
              return (
                <span
                  key={i}
                  className="flex min-w-full items-start"
                  style={{ backgroundColor: diff ? style.bg : undefined }}
                >
                  {showLineNumbers && (
                    <span
                      aria-hidden
                      className={cn(
                        "sticky left-0 shrink-0 select-none px-2 text-right text-ink-soft/60",
                        dualGutter ? "w-9" : "w-10",
                      )}
                    >
                      {before}
                    </span>
                  )}
                  {showLineNumbers && dualGutter && (
                    <span
                      aria-hidden
                      className="w-9 shrink-0 select-none pr-2 text-right text-ink-soft/60"
                    >
                      {line.numberAfter ?? ""}
                    </span>
                  )}
                  {diff && (
                    <span
                      aria-hidden
                      className="w-4 shrink-0 select-none text-center"
                      style={{ color: style.fg }}
                    >
                      {MARKER_SIGN[marker]}
                    </span>
                  )}
                  <span className={cn("min-w-0 flex-1 pr-3 text-ink", wrap && "break-words")}>
                    {/* The gutter and the +/- sign are both aria-hidden, being
                        duplicates of position and colour. That left assistive
                        technology hearing an added line and an unchanged one
                        identically. Text is the only channel that carries the
                        distinction, so the diff variant states it. */}
                    {diff && <span className="sr-only">{announce(line, marker, before)}</span>}
                    {renderLine ? renderLine(line, i) : line.content || " "}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
