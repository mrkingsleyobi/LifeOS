/**
 * DoorContext — the LifeOS context a non-Claude front door loads every session:
 * constitutional rules (LIFEOS_SYSTEM_PROMPT.md), identity, the CLAUDE.md
 * routing table, and a door-specific note on how to reach the Router's lanes
 * without Claude Code's Agent tool.
 *
 * Written between markers so anything the principal put in the target file
 * outside the block survives every remount.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export const BEGIN = "<!-- LIFEOS:BEGIN (managed by LIFEOS/{CODEX,PI}/Mount.ts — edits inside are overwritten) -->";
export const END = "<!-- LIFEOS:END -->";

const claude = () => process.env.LIFEOS_CLAUDE_DIR ?? join(homedir(), ".claude");
const strip = (s: string) => s.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const read = (p: string) => { try { return strip(readFileSync(p, "utf-8")); } catch { return ""; } };

export function doorContext(door: "codex" | "pi"): string {
  const c = claude();
  const L = join(c, "LIFEOS");
  const sys = read(join(L, "LIFEOS_SYSTEM_PROMPT.md"));
  const ids = ["PRINCIPAL/PRINCIPAL_IDENTITY.md", "DIGITAL_ASSISTANT/DA_IDENTITY.md"].map((f) => read(join(L, "USER", f))).filter(Boolean);
  const routing = read(join(c, "CLAUDE.md")).split("\n").filter((l) => !l.startsWith("@")).join("\n");
  const doorNote = door === "codex"
    ? `You are the LifeOS DA running inside **Codex CLI** — the same install, a different front door. Paths in the routing table are relative to ${c}/. There is no Agent tool here: when a \`🧭 ROUTER\` directive names a lane, run it with \`bun ${L}/ROUTER/Router.ts run <lane> --effort <effort> < brief\` (OpenAI lanes run through codex itself; Anthropic lanes through \`claude -p\`; PRIVATE through the local llama.cpp lane only).`
    : `You are the LifeOS DA running inside **Pi** — the same install, a different front door. Paths in the routing table are relative to ${c}/. When a \`🧭 ROUTER\` directive names a lane, run it with \`bun ${L}/ROUTER/Router.ts run <lane> --effort <effort> < brief\`. PRIVATE means the local llama.cpp lane only — never another provider.`;
  return [
    BEGIN,
    `# LifeOS (${door} front door)`,
    `Generated ${new Date().toISOString()} from ${c}. Re-run \`bun ${L}/${door.toUpperCase()}/Mount.ts\` after a LifeOS update.`,
    doorNote,
    ids.length ? `---\n# Identity\n\n${ids.join("\n\n")}` : "",
    sys ? `---\n# Constitutional rules\n\n${sys}` : "",
    routing ? `---\n# Routing table\n\n${routing}` : "",
    END,
  ].filter(Boolean).join("\n\n");
}

/** Replace (or append) the managed block in a file, keeping everything else. */
export function writeManaged(path: string, block: string) {
  mkdirSync(dirname(path), { recursive: true });
  const cur = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
  const next = i >= 0 && j > i ? cur.slice(0, i) + block + cur.slice(j + END.length) : (cur ? `${cur.trimEnd()}\n\n${block}\n` : `${block}\n`);
  writeFileSync(path, next);
}

export function removeManaged(path: string) {
  if (!existsSync(path)) return;
  const cur = readFileSync(path, "utf-8");
  const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
  if (i >= 0 && j > i) writeFileSync(path, (cur.slice(0, i) + cur.slice(j + END.length)).trim() + "\n");
}
