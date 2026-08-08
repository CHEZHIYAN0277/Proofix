/**
 * The `/design` gallery shell.
 *
 * A Storybook-equivalent proof surface: every token, state and primitive, in
 * both themes, rendering **no run data**.
 *
 * The theme control writes the same `.dark` class the product uses, so what
 * the gallery proves is what ships — there is no gallery-only theming path.
 */

import { Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "../components/Button";
import { Eyebrow } from "../primitives/atoms";

export type GalleryTheme = "light" | "dark";

const THEME_STORAGE_KEY = "proofix-theme";

/**
 * Reads and writes the same key and the same root class as the product's own
 * theme control, so toggling here is indistinguishable from toggling there.
 */
export function useGalleryTheme(): [GalleryTheme, (t: GalleryTheme) => void] {
  const [theme, setTheme] = useState<GalleryTheme>("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    const initial: GalleryTheme =
      stored === "light" || stored === "dark"
        ? stored
        : document.documentElement.classList.contains("dark")
          ? "dark"
          : "light";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const apply = (next: GalleryTheme) => {
    setTheme(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return [theme, apply];
}

export interface GallerySectionDef {
  id: string;
  title: string;
  /** One line on what this section proves. */
  summary: string;
  /** Blueprint reference, e.g. "§3.1". */
  reference: string;
  render: () => ReactNode;
}

export function GalleryShell({ sections }: { sections: GallerySectionDef[] }) {
  const [theme, setTheme] = useGalleryTheme();
  const [active, setActive] = useState(sections[0]?.id);

  // Highlights the section currently in view, so the index tracks the page
  // rather than only responding to clicks.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );

    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="min-h-screen bg-background text-ink">
      <header className="ds-glass sticky top-0 z-30 border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-6">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="type-title-3 text-ink">ProoFix Design System</span>
            <span className="type-caption hidden text-ink-soft sm:inline">
              Phase 0 · tokens, states and primitives — no run data
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon={theme === "dark" ? <Sun /> : <Moon />}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] gap-8 px-6 py-8">
        <nav
          aria-label="Gallery sections"
          className="sticky top-20 hidden h-fit w-52 shrink-0 flex-col gap-0.5 lg:flex"
        >
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={cn(
                "type-body-sm rounded-card px-2.5 py-1.5 transition-colors",
                active === s.id ? "bg-surface-muted text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {s.title}
            </a>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-16">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <header className="mb-5 border-b border-border pb-3">
                <Eyebrow>{s.reference}</Eyebrow>
                <h2 className="type-title-1 mt-1.5 text-ink">{s.title}</h2>
                <p className="type-body-sm mt-1 text-ink-soft">{s.summary}</p>
              </header>
              {s.render()}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   Layout helpers used by the sections
   ---------------------------------------------------------------------- */

export function Specimen({
  label,
  note,
  children,
  className,
}: {
  label: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="type-label text-ink">{label}</span>
        {note && <span className="type-caption text-right text-ink-soft">{note}</span>}
      </div>
      <div className="rounded-card border border-border bg-surface p-4">{children}</div>
    </div>
  );
}

export function SpecimenGrid({
  children,
  columns = 2,
}: {
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      className={cn(
        "grid gap-5",
        columns === 1 && "grid-cols-1",
        columns === 2 && "grid-cols-1 md:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** Marks a specimen that uses synthetic props from `gallery/samples.ts`. */
export function SampleNote({ children }: { children?: ReactNode }) {
  return (
    <span className="type-caption text-ink-soft">
      {children ?? "synthetic sample props — not run data"}
    </span>
  );
}
