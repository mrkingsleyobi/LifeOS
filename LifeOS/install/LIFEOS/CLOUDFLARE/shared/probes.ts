/**
 * Probe model shared by the local Bunker CLI (LIFEOS/BUNKER/Bunker.ts) and the
 * bunker-health Worker — ONE evaluator, so a probe can't pass locally and fail
 * in the cloud for a reason other than the network.
 *
 * Parsed from an ISA's `## Test Strategy` table, column order (parser contract,
 * ISAFormat.md §12):  isc | type | check | threshold | tool | anchors_to | severity | tier
 */

export interface StrategyRow {
  isc: string;
  type: string;           // bun-test | bun-property | bash | curl | screenshot | eval | manual
  check: string;
  threshold: string;
  tool: string;
  anchorsTo?: string;
  severity: "critical" | "normal";
  tier: "fast" | "deep";
}

export interface Probe {
  isc: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  expect: { status?: number; contains?: string; header?: string; maxMs?: number };
  severity: "critical" | "normal";
  tier: "fast" | "deep";
}

export interface ProbeResult { isc: string; ok: boolean; status?: number; ms: number; detail?: string; severity: "critical" | "normal" }

/** Split a markdown table row on unescaped pipes. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") { cur += "|"; i++; continue; }
    if (line[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += line[i];
  }
  out.push(cur.trim());
  return out.slice(1, -1);
}

export function parseTestStrategy(isa: string): StrategyRow[] {
  const start = isa.search(/^## Test Strategy\s*$/m);
  if (start < 0) return [];
  const body = isa.slice(start).split("\n").slice(1);
  const end = body.findIndex((l) => l.startsWith("## "));
  const rows: StrategyRow[] = [];
  for (const line of end < 0 ? body : body.slice(0, end)) {
    if (!line.trim().startsWith("|")) continue;
    const c = cells(line);
    if (c.length < 5 || /^-+$/.test(c[0].replace(/:/g, "")) || c[0].toLowerCase() === "isc") continue;
    const sev = c[6] && /^\w+$/.test(c[6]) ? c[6].toLowerCase() : "";
    rows.push({
      isc: c[0], type: c[1].toLowerCase(), check: c[2], threshold: c[3],
      tool: c[4].replace(/^`+|`+$/g, ""),
      anchorsTo: c[5] || undefined,
      severity: sev === "critical" ? "critical" : "normal",
      tier: (c[7] ?? "").toLowerCase() === "deep" ? "deep" : "fast",
    });
  }
  return rows;
}

/** Compile a curl row into a cloud-portable probe. Returns null for anything not portable. */
export function compileCurl(r: StrategyRow): Probe | null {
  if (r.type !== "curl") return null;
  const url = r.tool.match(/https?:\/\/[^\s'"]+/)?.[0];
  if (!url) return null;
  const method = r.tool.match(/-X\s+([A-Z]+)/)?.[1] ?? (/(?:^|\s)-[a-zA-Z]*I(?=\s|$)|--head\b/.test(r.tool) ? "HEAD" : "GET");
  const headers: Record<string, string> = {};
  for (const h of r.tool.matchAll(/-H\s+['"]([^:'"]+):\s*([^'"]*)['"]/g)) headers[h[1]] = h[2];
  const t = r.threshold.trim();
  const expect: Probe["expect"] = {};
  if (/^\d{3}$/.test(t)) expect.status = Number(t);
  else if (/^contains:/i.test(t)) { expect.contains = t.slice(9).trim(); expect.status = 200; }
  else if (/^header:/i.test(t)) expect.header = t.slice(7).trim().toLowerCase();
  else if (/^<\s*\d+\s*ms$/i.test(t)) { expect.maxMs = Number(t.match(/\d+/)![0]); expect.status = 200; }
  else expect.status = 200;
  return { isc: r.isc, url, method, headers, expect, severity: r.severity, tier: r.tier };
}

export async function runProbe(p: Probe, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const res = await fetchImpl(p.url, { method: p.method, headers: p.headers, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const ms = Date.now() - t0;
    const fail = (detail: string): ProbeResult => ({ isc: p.isc, ok: false, status: res.status, ms, detail, severity: p.severity });
    if (p.expect.status !== undefined && res.status !== p.expect.status) return fail(`status ${res.status} ≠ ${p.expect.status}`);
    if (p.expect.header && !res.headers.has(p.expect.header)) return fail(`missing header ${p.expect.header}`);
    if (p.expect.maxMs !== undefined && ms > p.expect.maxMs) return fail(`${ms}ms > ${p.expect.maxMs}ms`);
    if (p.expect.contains && !(await res.text()).includes(p.expect.contains)) return fail(`body lacks "${p.expect.contains}"`);
    return { isc: p.isc, ok: true, status: res.status, ms, severity: p.severity };
  } catch (e) {
    return { isc: p.isc, ok: false, ms: Date.now() - t0, detail: String(e), severity: p.severity };
  }
}

// ── Security plane: outsider-only checks against a deployed origin ──────────
export const EXPOSED_PATHS = ["/.env", "/.git/config", "/.git/HEAD", "/server-status", "/.DS_Store", "/wp-config.php.bak", "/backup.sql"];
export const REQUIRED_HEADERS = ["strict-transport-security", "x-content-type-options"];

export interface SecurityFinding { app: string; check: string; severity: "critical" | "high" | "medium" | "low"; detail: string }

export async function securityScan(app: string, origin: string, protectedPaths: string[], fetchImpl: typeof fetch = fetch): Promise<SecurityFinding[]> {
  const out: SecurityFinding[] = [];
  const get = (path: string) => fetchImpl(new URL(path, origin).toString(), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  try {
    const root = await get("/");
    for (const h of REQUIRED_HEADERS) if (!root.headers.has(h)) out.push({ app, check: `header:${h}`, severity: "medium", detail: `${h} missing on /` });
    const csp = root.headers.get("content-security-policy") ?? "";
    if (!root.headers.has("x-frame-options") && !/frame-ancestors/.test(csp)) out.push({ app, check: "clickjacking", severity: "low", detail: "no X-Frame-Options or CSP frame-ancestors" });
    if (origin.startsWith("http://")) out.push({ app, check: "tls", severity: "high", detail: "origin served over plain http" });
  } catch (e) { out.push({ app, check: "reachability", severity: "high", detail: String(e) }); return out; }
  for (const p of EXPOSED_PATHS) {
    try {
      const r = await get(p);
      if (r.status === 200 && (await r.text()).length > 0) out.push({ app, check: `exposed:${p}`, severity: p.includes(".env") || p.includes(".git") ? "critical" : "high", detail: `${p} returned 200` });
    } catch {}
  }
  for (const p of protectedPaths) {
    try {
      const r = await get(p);
      if (r.status === 200) out.push({ app, check: `auth-boundary:${p}`, severity: "critical", detail: `${p} served 200 without credentials` });
    } catch {}
  }
  return out;
}
