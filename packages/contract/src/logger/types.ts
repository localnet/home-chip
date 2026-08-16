/**
 * Severity levels, in ascending order and matching matter.js so the SDK and our own code share
 * one scale: the values are the SDK's lowercase level names, which its `Logger.level` accepts
 * directly, and the `plain` format lines up either side.
 *
 * A const object with a derived type rather than a TS `enum`, which `erasableSyntaxOnly` forbids
 * for emitting runtime code.
 */
export const LogLevel = {
    Debug: "debug",
    Info: "info",
    Notice: "notice",
    Warn: "warn",
    Error: "error",
    Fatal: "fatal",
} as const satisfies Record<string, string>;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];
