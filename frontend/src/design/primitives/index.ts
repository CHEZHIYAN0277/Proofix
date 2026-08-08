/**
 * Foundation primitives (blueprint §3.7).
 *
 * `<DataBoundary>` is the one that matters: every fact in the product is
 * wrapped in one, so an invented value cannot be rendered without deleting a
 * component.
 */

export * from "./DataBoundary";
export * from "./Reveal";
export * from "./StatusDot";
export * from "./MetricTile";
export * from "./Gauge";
export * from "./EvidenceList";
export * from "./ExplainAffordance";
export * from "./atoms";
