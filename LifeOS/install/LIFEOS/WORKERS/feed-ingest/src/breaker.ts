/**
 * Poller circuit breaker (Feed doc: "HTTP 200 but zero parsed items is a soft failure — increment
 * error_count rather than reset it"). Pure: state + outcome → next state.
 */
export type Outcome = "ok" | "empty" | "http_error" | "network_error" | "blocked";
export const MAX_ERRORS = 10;
const MAX_BACKOFF_MS = 24 * 3_600_000;

export interface SourceState { error_count: number; interval_min: number }
export interface NextState { error_count: number; disabled: 0 | 1; next_poll_at: number; last_status: Outcome }

export function nextState(s: SourceState, outcome: Outcome, nowMs: number): NextState {
  const healthy = outcome === "ok";
  const error_count = healthy ? 0 : s.error_count + 1;
  const base = s.interval_min * 60_000;
  const backoff = healthy ? base : Math.min(base * 2 ** Math.min(error_count, 5), MAX_BACKOFF_MS);
  return { error_count, disabled: error_count >= MAX_ERRORS ? 1 : 0, next_poll_at: nowMs + backoff, last_status: outcome };
}
