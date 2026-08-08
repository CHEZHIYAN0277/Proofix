/**
 * `<DiffView>` — a unified diff, syntax-highlighted (blueprint Phase 6).
 *
 * Built on `<CodeBlock>` through the `renderLine` seam that component reserved
 * for exactly this: the gutters, wrapping, copy and line numbers are already
 * specified there, and this adds tokens and nothing else.
 *
 * Three decisions worth stating.
 *
 * **Shiki loads lazily, client-side, and never blocks the diff.** The
 * highlighter is ~1MB of grammars and themes; the diff renders unhighlighted on
 * first paint and re-renders with tokens when it arrives. A highlighter that
 * fails to load — offline, blocked, an unsupported language — leaves plain
 * monospace text, which is a complete and readable diff. Nothing here is
 * load-bearing for correctness.
 *
 * **Each side is highlighted as a whole file, not line by line.** A diff body
 * interleaves removed and added lines, so highlighting it as one document
 * produces tokens for a program that never existed — an unterminated string on
 * a removed line would tint the rest of the hunk. Both full sources are
 * available (A7 stores them), so `original` and `patched` are highlighted
 * separately and each rendered line takes its tokens from the side it came
 * from, indexed by its own line number.
 *
 * **Both themes are resolved at highlight time.** Shiki emits `--shiki-light`
 * and `--shiki-dark` per token and the CSS in `tokens.css` picks one; the theme
 * can therefore change without re-highlighting.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
// Type-only: erased at build, so nothing from Shiki reaches a chunk except
// through the dynamic imports below.
import type { HighlighterCore } from "shiki/core";

import { cn } from "@/lib/utils";
import { CodeBlock, type CodeLine, type DiffMarker } from "./CodeBlock";

/** One rendered diff line, carrying the numbers on both sides. */
export interface DiffViewLine {
  content: string;
  marker: DiffMarker;
  /** Line number in the pre-patch file, or `null` for an addition. */
  oldNumber: number | null;
  /** Line number in the post-patch file, or `null` for a removal. */
  newNumber: number | null;
  /** `@@ … @@` — rendered as a separator, never highlighted as source. */
  hunkHeader?: boolean;
}

export interface DiffViewProps {
  lines: DiffViewLine[];
  /** Pre-patch source in full — the token source for removed/context lines. */
  original: string;
  /** Post-patch source in full — the token source for added lines. */
  patched: string;
  filename?: string;
  /**
   * Shiki language id. Omit to infer from `filename`; an unrecognised
   * extension means no highlighting rather than a wrong grammar.
   */
  language?: Language;
  maxHeight?: number | string;
  className?: string;
}

/* -------------------------------------------------------------------------
   Language
   ---------------------------------------------------------------------- */

/**
 * Extensions this product actually patches, mapped to Shiki grammars.
 *
 * Deliberately short: A7 is `ast`-bound and writes Python, and the other
 * entries cover the files a repair touches around it. An extension absent here
 * renders unhighlighted, which is correct — guessing a grammar produces
 * confidently wrong colours.
 */
const GRAMMARS = {
  python: () => import("@shikijs/langs/python"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  toml: () => import("@shikijs/langs/toml"),
  yaml: () => import("@shikijs/langs/yaml"),
  markdown: () => import("@shikijs/langs/markdown"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
} as const;

/** A language this component can highlight — one grammar chunk each. */
export type Language = keyof typeof GRAMMARS;

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  py: "python",
  pyi: "python",
  ts: "typescript",
  tsx: "tsx",
  jsx: "tsx",
  js: "javascript",
  json: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "shellscript",
  sql: "sql",
};

function inferLanguage(filename: string | undefined): Language | null {
  if (!filename) return null;
  const base = filename.split("/").pop() ?? filename;
  const extension = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  if (extension) return LANGUAGE_BY_EXTENSION[extension] ?? null;
  // requirements.txt has an extension; Dockerfile and Makefile do not, and
  // neither has a grammar worth the bundle here.
  return null;
}

/* -------------------------------------------------------------------------
   Highlighting
   ---------------------------------------------------------------------- */

/** One token as Shiki resolved it for both themes. */
interface Token {
  content: string;
  style: Record<string, string>;
}

/** Tokens per line, 0-indexed, for one whole file. */
type TokenLines = Token[][];

interface Highlighted {
  original: TokenLines;
  patched: TokenLines;
}

/**
 * One highlighter per language, built once and shared.
 *
 * `shiki`'s bundled entry point registers every grammar it ships — ~200 lazy
 * chunks, and a registry that has to be shipped to know they exist. The core
 * entry point takes the grammars and themes it is handed and nothing else, so
 * the build emits exactly the languages `GRAMMARS` lists. Same for the engine:
 * the JavaScript one avoids the Oniguruma WASM binary entirely, in `forgiving`
 * mode so a pattern it cannot compile degrades that token rather than throwing
 * away the file.
 */
const HIGHLIGHTERS = new Map<Language, Promise<HighlighterCore>>();

function highlighterFor(language: Language): Promise<HighlighterCore> {
  const existing = HIGHLIGHTERS.get(language);
  if (existing) return existing;

  const created = (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, grammar, light, dark] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        GRAMMARS[language](),
        import("@shikijs/themes/github-light"),
        import("@shikijs/themes/github-dark"),
      ]);

    return createHighlighterCore({
      langs: [grammar.default],
      themes: [light.default, dark.default],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();

  HIGHLIGHTERS.set(language, created);
  return created;
}

/**
 * Highlight both sides once, on the client, after paint.
 *
 * Returns `null` until (and unless) it succeeds; every caller renders plain
 * text in that case, so a rejection needs no error surface of its own — there
 * is nothing the reader could do about it and nothing missing from the diff.
 */
function useHighlighted(
  original: string,
  patched: string,
  language: Language | null,
): Highlighted | null {
  const [tokens, setTokens] = useState<Highlighted | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!language) {
      setTokens(null);
      return;
    }

    const request = ++requestRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const highlighter = await highlighterFor(language);
        if (cancelled || request !== requestRef.current) return;

        const toLines = (code: string): TokenLines =>
          highlighter
            .codeToTokens(code, {
              lang: language,
              themes: { light: "github-light", dark: "github-dark" },
              // Emit `--shiki-light`/`--shiki-dark` rather than a baked-in
              // `color`, so the theme switch is a CSS concern.
              defaultColor: false,
            })
            .tokens.map((line) =>
              line.map((token) => ({ content: token.content, style: token.htmlStyle ?? {} })),
            );

        setTokens({ original: toLines(original), patched: toLines(patched) });
      } catch {
        // Grammar missing, chunk unreachable, or the environment has no
        // dynamic import. Plain text is the whole fallback.
        if (!cancelled) setTokens(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [original, patched, language]);

  return tokens;
}

/* -------------------------------------------------------------------------
   Component
   ---------------------------------------------------------------------- */

export function DiffView({
  lines,
  original,
  patched,
  filename,
  language,
  maxHeight = 460,
  className,
}: DiffViewProps) {
  const lang = language ?? inferLanguage(filename);
  const highlighted = useHighlighted(original, patched, lang);

  // Both numbers go to `<CodeBlock>`, which renders them as two columns.
  // Collapsing them into one was wrong: a diff numbers two different files, so
  // a single column has to keep switching between them silently — a removed
  // line reading `14` followed by an added line reading `13` is not a
  // going-backwards file, it is two files, and the reader could not tell.
  const codeLines = useMemo<CodeLine[]>(
    () =>
      lines.map((line) => ({
        content: line.content,
        marker: line.marker,
        number: line.hunkHeader ? null : line.oldNumber,
        numberAfter: line.hunkHeader ? null : line.newNumber,
      })),
    [lines],
  );

  const renderLine = (_line: CodeLine, index: number): ReactNode => {
    const line = lines[index];
    if (!line) return null;

    if (line.hunkHeader) {
      return <span className="text-ink-soft/70">{line.content}</span>;
    }

    if (!highlighted) return line.content || " ";

    // Added lines exist only in the patched file; everything else is quoted
    // from the original. Context lines are identical on both sides, so either
    // index is correct and the original is the one that always has them.
    const side = line.marker === "add" ? highlighted.patched : highlighted.original;
    const number = line.marker === "add" ? line.newNumber : line.oldNumber;
    const tokens = number === null ? undefined : side[number - 1];

    if (!tokens) return line.content || " ";

    return (
      <>
        {tokens.map((token, i) => (
          <span key={i} className="shiki-token" style={token.style as CSSProperties}>
            {token.content}
          </span>
        ))}
      </>
    );
  };

  return (
    <CodeBlock
      lines={codeLines}
      diff
      filename={filename}
      language={lang ?? undefined}
      maxHeight={maxHeight}
      renderLine={renderLine}
      className={cn(className)}
    />
  );
}
