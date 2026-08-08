/**
 * ProoFix Design System (Workspace V2, Phase 0).
 *
 * The visual language every surface inherits — Landing, Workspace, Dashboard,
 * Security, Learning, Organization, Settings, Digital Twin. **No page may
 * introduce a UI pattern that does not exist here.**
 *
 * Consumed by V1 and V2 alike. The CSS token layer is imported once by
 * `src/styles.css`; everything else is imported from this barrel.
 *
 *   tokens/     typography · spacing · radius · elevation · motion · color
 *   primitives/ DataBoundary · Reveal · StatusDot · MetricTile · Gauge ·
 *               EvidenceList · ExplainAffordance · atoms
 *   states/     Skeleton · Empty · Loading · Error · Waiting/Pending/Unavailable
 *   components/ Card · Button · Input · Panel · Table · GraphChrome · CodeBlock
 *   identity/   agent avatar generator + icon set, keyed on `agent_id`
 *   gallery/    the `/design` route
 */

export * from "./types";
export * from "./tokens";
export * from "./primitives";
export * from "./states";
export * from "./components";
export * from "./identity";
