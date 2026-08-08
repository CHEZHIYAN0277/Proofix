/**
 * Live contrast audit for the gallery.
 *
 * The blueprint requires the status, semantic, data-state and graph palettes
 * to be contrast-audited in both themes. Asserting a number in a comment is
 * not an audit, so the gallery measures the *resolved* value of each token in
 * the browser and shows the result. Flip the theme and the numbers change.
 */

/** Resolve a CSS custom property to a concrete color string. */
export function resolveVar(cssVar: string, el?: Element): string {
  if (typeof window === "undefined") return "";
  const target = el ?? document.documentElement;
  const name = cssVar.startsWith("var(") ? cssVar.slice(4, -1).trim() : cssVar;
  return getComputedStyle(target).getPropertyValue(name).trim();
}

/**
 * Parse a color string into sRGB 0–255. Uses the browser to normalise, so
 * `oklch()`, `color-mix()`, hex and named colors all work.
 */
export function toRgb(color: string): [number, number, number] | null {
  if (typeof document === "undefined" || !color) return null;

  const probe = document.createElement("span");
  probe.style.color = color;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  const match = computed.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;

  const parts = match[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.1 contrast ratio, 1–21. Returns `null` if either color is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = toRgb(a);
  const rgbB = toRgb(b);
  if (!rgbA || !rgbB) return null;

  const lA = relativeLuminance(rgbA);
  const lB = relativeLuminance(rgbB);
  const [hi, lo] = lA > lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastGrade = "AAA" | "AA" | "AA-large" | "fail";

/** Grade against WCAG thresholds for normal text unless `large`. */
export function grade(ratio: number, large = false): ContrastGrade {
  if (large) {
    if (ratio >= 4.5) return "AAA";
    if (ratio >= 3) return "AA";
    return "fail";
  }
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}
