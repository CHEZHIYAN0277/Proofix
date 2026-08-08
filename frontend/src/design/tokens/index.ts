/**
 * Design system token layer (blueprint §3.1–§3.5).
 *
 * The CSS lives in `tokens.css`, imported once by `src/styles.css`. These
 * modules are the programmatic index: they let components pick a token by
 * name and let `/design` prove every one of them in both themes.
 */

export * from "./typography";
export * from "./spacing";
export * from "./elevation";
export * from "./motion";
export * from "./color";
