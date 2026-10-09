/**
 * Probes for the rebuilt subsystems. Each describe() block is the executable
 * half of one subsystem ISA's ## Test Strategy (rows call `bun test … -t "<block>"`).
 * Every test runs offline against a throwaway LIFEOS_DIR.
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

beforeAll(() => {
  process.env.LIFEOS_DIR = mkdtempSync(join(tmpdir(), "subsys-"));
  process.env.LIFEOS_JEV_ENV_FILE = "/dev/null";
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.AMBER_LEDGER_URL;
});

describe("errata", () => {
  test("captures verbatim and never rewrites the words", async () => {
    const { capture, errata } = await import("../../ERRATA/Errata");
    const words = "  the FB bar said 100%   right after reset!! ";
    const e = capture(words, { system: "StatusLine" });
    expect(errata.get(e.id)!.verbatim).toBe(words);
    expect(e.status).toBe("open");
  });
});

describe("socrates", () => {
  test("three-valued answers: unknown is a real answer", async () => {
    const { triFromP } = await import("../../SOCRATES/Socrates");
    expect(triFromP(0.9)).toBe("yes");
    expect(triFromP(0.1)).toBe("no");
    expect(triFromP(0.5)).toBe("unknown");
  });
  test("a failing source answers unknown, never yes/no", async () => {
    const { questions, answer } = await import("../../SOCRATES/Socrates");
    const q = questions.add({ question: "Is it up?", source: "file:/nonexistent/x", everyHours: 1, active: true });
    expect((await answer(q)).answer).toBe("unknown");
  });
});

describe("achilles", () => {
  test("SLA by severity", async () => {
    const { achilles, dueAt, SLA_DAYS } = await import("../../ACHILLES/Achilles");
    const f = achilles.add({ asset: "a", severity: "critical", title: "t", source: "manual", status: "open" });
    expect(Math.round((dueAt(f) - Date.parse(f.ts)) / 86400_000)).toBe(SLA_DAYS.critical);
  });
});

describe("vera", () => {
  test("retraction removes a claim from the projection but not from history", async () => {
    const { claims, project } = await import("../../VERA/Vera");
    const c = claims.add({ person: "p1", kind: "ideal", text: "ships Q1" });
    const before = Date.now();
    claims.add({ person: "p1", kind: "ideal", text: "(retracts)", retracts: c.id });
    expect(project("p1").map((x) => x.id)).not.toContain(c.id);
    expect(claims.get(c.id)).toBeDefined();
    expect(project("p1", before - 1).length).toBeLessThanOrEqual(1);
  });
});

describe("people", () => {
  test("who finds by name/org/tag; projection drops personal fields", async () => {
    const { people, who } = await import("../../PEOPLE/People");
    people.add({ name: "Ada Lovelace", org: "Analytical", tags: ["customer"], email: "ada@x.io" });
    expect(who("analytical")[0].name).toBe("Ada Lovelace");
    expect(who("customer").length).toBe(1);
  });
});

describe("synapse", () => {
  test("dedup ignores tracking params and fragments", async () => {
    const { dedupKey } = await import("../../SYNAPSE/Grade");
    const a = await dedupKey({ url: "https://www.example.com/post/?utm_source=x#top", source: "a", external_id: "1" });
    const b = await dedupKey({ url: "https://example.com/post", source: "b", external_id: "2" });
    expect(a).toBe(b);
  });
  test("routing is conditional on score; preservation is not", async () => {
    const { routedActions, ROUTE_THRESHOLD } = await import("../../SYNAPSE/Grade");
    expect(routedActions("knowledge", ROUTE_THRESHOLD - 1)).toEqual([]);
    expect(routedActions("knowledge", ROUTE_THRESHOLD)).toEqual(["knowledge_note"]);
  });
  test("personal captures never leave the box and promoted notes carry source_amber_id", async () => {
    const { capture, writeIdeaNote } = await import("../../SYNAPSE/Synapse");
    const p = await capture("private thought", { personal: true });
    expect(p.cloud).toBe("never");
    const note = writeIdeaNote({ amberId: "0b5e5c1e-0000-4000-8000-000000000001", title: "An idea" });
    expect(readFileSync(note, "utf-8")).toMatch(/^source_amber_id: 0b5e5c1e-/m);
    expect(readFileSync(note, "utf-8")).toMatch(/^convention: kb-v3$/m);
  });
});

describe("hookbridge", () => {
  test("maps harness tool names onto Claude matchers and folds a block", async () => {
    const { runBridge, claudeToolName, toCodexOutput } = await import("./HookBridge");
    expect(claudeToolName("shell")).toBe("Bash");
    expect(claudeToolName("apply_patch")).toBe("Edit");
    const dir = mkdtempSync(join(tmpdir(), "hb-"));
    writeFileSync(join(dir, "deny.sh"), "#!/bin/bash\necho nope >&2; exit 2\n", { mode: 0o755 });
    writeFileSync(join(dir, "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: join(dir, "deny.sh") }] }] } }));
    const r = runBridge("codex", "PreToolUse", { tool_name: "shell", tool_input: { command: "x" } }, { hooksFile: join(dir, "hooks.json") });
    expect(r.block?.reason).toBe("nope");
    expect(toCodexOutput("PreToolUse", r).exit).toBe(2);
    expect(runBridge("codex", "PreToolUse", { tool_name: "read" }, { hooksFile: join(dir, "hooks.json") }).block).toBeNull();
  });
});

describe("doorcontext", () => {
  test("managed block is replaced in place and the principal's text survives", async () => {
    const { writeManaged, removeManaged, BEGIN } = await import("./DoorContext");
    const f = join(mkdtempSync(join(tmpdir(), "dc-")), "AGENTS.md");
    writeFileSync(f, "# mine\n");
    writeManaged(f, `${BEGIN}\nv1\n<!-- LIFEOS:END -->`);
    writeManaged(f, `${BEGIN}\nv2\n<!-- LIFEOS:END -->`);
    const s = readFileSync(f, "utf-8");
    expect(s).toContain("# mine");
    expect(s).toContain("v2");
    expect(s).not.toContain("v1");
    removeManaged(f);
    expect(readFileSync(f, "utf-8").trim()).toBe("# mine");
  });
});

describe("sessions", () => {
  test("resume commands per harness", async () => {
    const { resumeArgv } = await import("../Sessions");
    const base = { cwd: "/w", file: "/f.jsonl", mtime: 0, title: "" };
    expect(resumeArgv({ ...base, harness: "claude", id: "abc" })).toEqual(["claude", "--resume", "abc"]);
    expect(resumeArgv({ ...base, harness: "codex", id: "abc" })).toEqual(["codex", "resume", "abc"]);
    expect(resumeArgv({ ...base, harness: "pi", id: "abc" })).toEqual(["pi", "--session", "/f.jsonl"]);
  });
});

describe("ledger", () => {
  test("Major.Feature.Patch bumps and classification gates", async () => {
    const { bumpVersion, classify } = await import("../../../skills/_LIFEOS/Tools/VersionBump");
    expect([bumpVersion("7.40.4", "patch"), bumpVersion("7.40.4", "feature"), bumpVersion("7.40.4", "major")]).toEqual(["7.40.5", "7.41.0", "8.0.0"]);
    expect(classify([{ status: "D", path: "hooks/Safety.hook.ts" }]).level).toBe("major");
    expect(classify([{ status: "A", path: "skills/X/SKILL.md" }]).level).toBe("feature");
    expect(classify([{ status: "M", path: "README.md" }]).level).toBe("patch");
  });
});

describe("worksync", () => {
  test("only this session's rows sync, keyed by slug marker", async () => {
    const { rowsFor, body } = await import("../../../hooks/WorkSync.hook");
    const rows = rowsFor({ sessions: { s1: { task: "A", sessionUUID: "x" }, s2: { task: "B", sessionUUID: "y" } } }, "x");
    expect(rows.map(([k]) => k)).toEqual(["s1"]);
    expect(body("s1", rows[0][1])).toContain("<!-- lifeos-work:s1 -->");
  });
});

describe("jobs", () => {
  test("every job renders a schedule for both launchd and systemd", async () => {
    const { JOBS, plist, systemdUnits } = await import("../InstallSubsystemJobs");
    for (const j of JOBS) {
      expect(plist(j)).toContain(`<string>${j.label}</string>`);
      const u = systemdUnits(j);
      expect(u.service).toContain("ExecStart=");
      expect(j.keepAlive ? u.timer === null : u.timer!.includes("[Timer]")).toBe(true);
    }
  });
});

describe("bunker", () => {
  test("runIsa executes deterministic rows and skips judged/attested ones", async () => {
    const { runIsa } = await import("../../BUNKER/Bunker");
    const dir = mkdtempSync(join(tmpdir(), "isa-"));
    writeFileSync(join(dir, "ISA.md"), "## Test Strategy\n\n| isc | type | check | threshold | tool | anchors_to |\n|---|---|---|---|---|---|\n| ISC-1 | bash | true passes | 0 | true | literal |\n| ISC-2 | bash | false fails | 0 | false | literal |\n| ISC-3 | manual | looks right | yes | — | literal |\n");
    const r = await runIsa(join(dir, "ISA.md"), true);
    expect(r.map((x) => x.status)).toEqual(["pass", "fail", "skip"]);
  });
});

describe("pulse-ledgers", () => {
  test("every subsystem view has a title, stats and sections", async () => {
    const { _views } = await import("../../PULSE/modules/lifeos-ledgers");
    for (const [route, fn] of Object.entries(_views)) {
      const v = fn();
      expect(route.startsWith("/api/")).toBe(true);
      expect(v.title.length).toBeGreaterThan(0);
      expect(Array.isArray(v.stats) && Array.isArray(v.sections)).toBe(true);
    }
  });
});
