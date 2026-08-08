/**
 * `/design` — the Phase 0 design system gallery (blueprint §11).
 *
 * Flag-gated behind `FEATURE_WORKSPACE_V2`. Off ⇒ not found, matching the
 * root route's 404 presentation.
 *
 * The flag's `?v2=` / `localStorage` override is a client concern, so the gate
 * resolves after mount rather than during the server render. Until it
 * resolves the route renders nothing — a flash of the gallery followed by a
 * 404 would be worse than a beat of blank.
 */

import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { DesignGallery } from "@/design/gallery";
import { resolveWorkspaceV2Flag } from "@/lib/v2/flag";

export const Route = createFileRoute("/design")({
  head: () => ({
    meta: [
      { title: "ProoFix — Design System" },
      {
        name: "description",
        content: "Token and component gallery for the ProoFix design system. Renders no run data.",
      },
      // Internal proof surface; it has no business in a search index.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DesignRoute,
});

function DesignRoute() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    setEnabled(resolveWorkspaceV2Flag());
  }, []);

  if (enabled === null) return null;
  if (!enabled) return <FlagDisabled />;

  return <DesignGallery />;
}

function FlagDisabled() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="type-display text-ink">404</h1>
        <h2 className="type-title-2 mt-4 text-ink">Page not found</h2>
        <p className="type-body-sm mt-2 text-ink-soft">
          The design gallery is behind <code className="type-mono">FEATURE_WORKSPACE_V2</code>.
          Enable it with <code className="type-mono">VITE_FEATURE_WORKSPACE_V2=1</code>, or open{" "}
          <code className="type-mono">/design?v2=1</code> to override for this browser.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="type-label inline-flex items-center justify-center rounded-card bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
