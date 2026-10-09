/**
 * Ledger — the one append-mostly JSONL store the subsystem runtimes share
 * (Errata, Socrates, Achilles, Vera, People). One line per record; updates
 * rewrite the file atomically. Verbatim capture is the contract: fields a
 * human wrote are never normalized on write.
 *
 * Paths resolve under LIFEOS_DIR at call time (tests and the statusline set it).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export const lifeosDir = () => {
  const v = process.env.LIFEOS_DIR;
  return v && !/^\$\{?HOME/.test(v) ? v : join(homedir(), ".claude", "LIFEOS");
};

export interface Row { id: string; ts: string }

export class Ledger<T extends Row> {
  constructor(private readonly rel: string, private readonly prefix: string) {}

  get path() { return join(lifeosDir(), this.rel); }

  newId(): string {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `${this.prefix}-${d}-${crypto.randomUUID().slice(0, 6)}`;
  }

  all(): T[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf-8").split("\n").filter(Boolean).flatMap((l: string) => {
      try { return [JSON.parse(l) as T]; } catch { return []; }
    });
  }

  get(id: string): T | undefined {
    return this.all().find((r) => r.id === id);
  }

  add(row: Omit<T, "id" | "ts"> & Partial<Row>): T {
    const full = { id: row.id ?? this.newId(), ts: row.ts ?? new Date().toISOString(), ...row } as T;
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(full) + "\n");
    return full;
  }

  update(id: string, patch: Partial<T>): T | undefined {
    const rows = this.all();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return undefined;
    rows[i] = { ...rows[i], ...patch, id: rows[i].id };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    renameSync(tmp, this.path);
    return rows[i];
  }
}

/** Tiny argv helper shared by the subsystem CLIs. */
export function args(argv = process.argv.slice(2)) {
  const pos: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("--")) { flags[k] = v; i++; } else flags[k] = "true";
    } else pos.push(a);
  }
  return { pos, flags };
}
