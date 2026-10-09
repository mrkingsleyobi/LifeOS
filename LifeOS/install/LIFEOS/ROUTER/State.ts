/**
 * ROUTER STATE — what the statusline reads to light lanes.
 *
 *   MEMORY/STATE/router/last.json            newest decision (any session)
 *   MEMORY/STATE/router/sessions/<sid>.json  { last, lanes: {sol: 3, …}, agents: {…} }
 *
 * Writes are atomic (tmp + rename) because the statusline reads every tick.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { RouteDecision } from "./FrontDoor";

const LIFEOS = () => {
  const v = process.env.LIFEOS_DIR;
  return v && !/^\$\{?HOME/.test(v) ? v : join(homedir(), ".claude", "LIFEOS");
};
export const stateDir = () => join(LIFEOS(), "MEMORY", "STATE", "router");

function atomicWrite(path: string, data: unknown) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, path);
}

export interface SessionRouterState {
  last: (RouteDecision & { at: number }) | null;
  lanes: Record<string, number>;
}

export function readSession(sid: string): SessionRouterState {
  try { return JSON.parse(readFileSync(join(stateDir(), "sessions", `${sid}.json`), "utf-8")); }
  catch { return { last: null, lanes: {} }; }
}

export function writeDecision(d: RouteDecision, sid?: string) {
  const dir = stateDir();
  mkdirSync(join(dir, "sessions"), { recursive: true });
  const stamped = { ...d, at: Date.now() };
  atomicWrite(join(dir, "last.json"), { ...stamped, session: sid ?? null });
  if (!sid || !/^[A-Za-z0-9-]+$/.test(sid)) return;
  const s = readSession(sid);
  s.last = stamped;
  const used = new Set([d.lane, d.combo?.reviewer, ...(d.fusion?.members ?? []), d.fusion?.synthesizer].filter(Boolean) as string[]);
  for (const l of used) s.lanes[l] = (s.lanes[l] ?? 0) + 1;
  atomicWrite(join(dir, "sessions", `${sid}.json`), s);
}
