/**
 * Reading A7's diff — parsing, not diffing.
 *
 * The bundle carries both sides of every file, so the client *could* compute
 * its own diff. It must not. `diff_text` is what A7 generated with Python's
 * `unified_diff`, it is the exact text A10's MCI verification checked the PR
 * description against, and it is what the proof bundle records. A second,
 * independently computed diff could disagree with the one the merge decision
 * was made from — and the reader would have no way to tell which they were
 * looking at.
 *
 * So this file parses. Everything below is a rearrangement of A7's own output:
 * splitting a multi-file diff by its `---`/`+++` headers, tracking line numbers
 * from the `@@` hunk headers, and pairing each file section with the candidate
 * that produced it.
 */

import type { DiffViewLine } from "@/design/components/DiffView";
import type { PatchBundle, PatchCandidate } from "@/lib/v2/types";

/** One file's section of the unified diff, ready for `<DiffView>`. */
export interface FileDiff {
  /** Path as the candidate records it — the bundle's identity for the file. */
  file: string;
  candidate: PatchCandidate;
  lines: DiffViewLine[];
  added: number;
  removed: number;
  /**
   * `true` when the diff carried no section for this candidate.
   *
   * A7 writes a candidate only after `has_semantic_diff` passes, so an empty
   * section should be impossible — which is exactly why it is surfaced rather
   * than smoothed over.
   */
  missingFromDiff: boolean;
}

const FILE_HEADER = /^\+\+\+ b\/(.+?)(?:\t.*)?$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strip a leading `a/` or `b/` and normalise separators for comparison. */
function normalise(path: string): string {
  return path
    .replace(/^[ab]\//, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
}

/** The two sides of one file, split into lines — the authority for a split. */
export interface FileSources {
  original: string[];
  patched: string[];
}

/**
 * Split `diff_text` into one line list per file.
 *
 * `unified_diff` is called once per candidate and the results concatenated, so
 * the sections appear in candidate order and each opens with its own
 * `---`/`+++` pair. Anything before the first pair is not part of a file
 * section and is dropped.
 *
 * `sources` handles a real quirk of the backend's output rather than a
 * hypothetical one. `difflib.unified_diff` emits each line exactly as it found
 * it, so when a file does not end in a newline the diff has no line break
 * either and two entries land on one physical line:
 *
 *     @@ -1 +1 @@
 *     -x = 1+x = 2
 *
 * Given the file it came from, that is unambiguous — the removed line must be
 * the pre-patch file's line 1 — so the split is a *lookup*, not a guess, and
 * it happens only where the leading text matches the source exactly and the
 * remainder begins with a diff sign. Without `sources`, or where the match
 * fails, the physical line is kept whole: a visibly odd line is better than a
 * confidently invented pair.
 */
export function parseUnifiedDiff(
  diffText: string,
  sources?: (file: string) => FileSources | undefined,
): Map<string, DiffViewLine[]> {
  const sections = new Map<string, DiffViewLine[]>();
  if (!diffText) return sections;

  let current: DiffViewLine[] | null = null;
  let source: FileSources | undefined;
  let oldLine = 0;
  let newLine = 0;

  /** Record one diff entry, advancing whichever side(s) it belongs to. */
  const push = (sign: string, content: string) => {
    if (sign === "+") {
      current!.push({ content, marker: "add", oldNumber: null, newNumber: newLine++ });
    } else if (sign === "-") {
      current!.push({ content, marker: "remove", oldNumber: oldLine++, newNumber: null });
    } else {
      current!.push({ content, marker: "context", oldNumber: oldLine++, newNumber: newLine++ });
    }
  };

  /** The line this entry must be, according to the file it came from. */
  const expected = (sign: string): string | undefined =>
    sign === "+" ? source?.patched[newLine - 1] : source?.original[oldLine - 1];

  const consume = (raw: string) => {
    let rest = raw;
    let recovered = false;

    // Bounded by the length of the physical line: every iteration consumes at
    // least the sign plus one matched line.
    for (;;) {
      // A file with no trailing newline swallows whatever follows it, and what
      // follows the last line of a section is the next section's header. It
      // belongs to no file's body, and the `+++` half on the next physical
      // line opens that section correctly regardless.
      if (recovered && rest.startsWith("--- ")) return;

      const sign = rest[0];
      const body = rest.slice(1);
      const line = expected(sign);

      if (
        line !== undefined &&
        line !== "" &&
        body.length > line.length &&
        body.startsWith(line) &&
        /^[-+ ]/.test(body.slice(line.length))
      ) {
        push(sign, line);
        rest = body.slice(line.length);
        recovered = true;
        continue;
      }

      push(sign, body);
      return;
    }
  };

  for (const raw of diffText.split("\n")) {
    const header = FILE_HEADER.exec(raw);
    if (header) {
      const file = normalise(header[1]);
      current = sections.get(file) ?? [];
      sections.set(file, current);
      source = sources?.(file);
      continue;
    }

    // The `--- a/…` half of the pair opens a section the `+++` half names, so
    // it carries no content and no numbers.
    if (raw.startsWith("--- ")) continue;
    if (current === null) continue;

    const hunk = HUNK_HEADER.exec(raw);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      current.push({
        content: raw,
        marker: "context",
        oldNumber: null,
        newNumber: null,
        hunkHeader: true,
      });
      continue;
    }

    if (raw.startsWith("+") || raw.startsWith("-") || raw.startsWith(" ")) {
      consume(raw);
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — a note about the file, not a line in
      // it. Numbering it would shift every line after it.
      current.push({
        content: raw,
        marker: "context",
        oldNumber: null,
        newNumber: null,
        hunkHeader: true,
      });
    }
    // A blank final element from the trailing newline, or any line the format
    // does not define, is skipped rather than rendered as empty context.
  }

  return sections;
}

/**
 * Every candidate in the bundle, paired with its section of the diff.
 *
 * Candidates drive the list, not the diff: the bundle is the record of what
 * A7 wrote, so a candidate whose section is missing is shown as a candidate
 * with a stated gap rather than omitted from the stage.
 */
export function fileDiffs(bundle: PatchBundle): FileDiff[] {
  const byPath = new Map<string, FileSources>(
    (bundle.patches ?? []).map((candidate) => [
      normalise(candidate.file),
      { original: candidate.original.split("\n"), patched: candidate.patched.split("\n") },
    ]),
  );

  const sections = parseUnifiedDiff(bundle.diff_text ?? "", (file) => byPath.get(file));

  return (bundle.patches ?? []).map((candidate) => {
    const lines = sections.get(normalise(candidate.file)) ?? [];
    return {
      file: candidate.file,
      candidate,
      lines,
      added: lines.filter((l) => l.marker === "add").length,
      removed: lines.filter((l) => l.marker === "remove").length,
      missingFromDiff: lines.length === 0,
    };
  });
}

/** Added and removed line totals across the bundle. */
export function diffTotals(files: FileDiff[]): { added: number; removed: number } {
  return files.reduce(
    (totals, file) => ({
      added: totals.added + file.added,
      removed: totals.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
}
