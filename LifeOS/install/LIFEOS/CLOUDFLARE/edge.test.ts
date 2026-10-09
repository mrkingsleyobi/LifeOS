import { describe, expect, test } from "bun:test";
import { parseTestStrategy, compileCurl } from "./shared/probes";
import { cronMatches } from "./workers/arbol/src/index";
import { safeEqual } from "./shared/edge";

const ISA = `# App

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity | tier |
|-----|------|-------|-----------|------|------------|----------|------|
| ISC-1 | curl | home serves | 200 | \`curl -sI https://example.com/\` | literal | critical | |
| ISC-2 | curl | health body | contains: ok | curl https://example.com/health | literal | | deep |
| ISC-3 | bash | lint passes | 0 | bun run lint | literal | | |
| ISC-4 | curl | piped \\| cmd | header: strict-transport-security | curl -sI https://example.com | literal | | |
| ISC-5 | eval | tone is right | 0.8 | Evals | literal | | |

## Decisions
- none
`;

describe("ISA Test Strategy parser", () => {
  const rows = parseTestStrategy(ISA);
  test("reads every row and stops at the next section", () => expect(rows.map((r) => r.isc)).toEqual(["ISC-1", "ISC-2", "ISC-3", "ISC-4", "ISC-5"]));
  test("severity and tier columns", () => {
    expect(rows[0].severity).toBe("critical");
    expect(rows[1].tier).toBe("deep");
    expect(rows[2].severity).toBe("normal");
  });
  test("backticks are stripped from tool", () => expect(rows[0].tool).toBe("curl -sI https://example.com/"));
  test("escaped pipes stay inside a cell", () => expect(rows[3].check).toBe("piped | cmd"));
  test("works when Test Strategy is the last section", () => expect(parseTestStrategy(ISA.split("## Decisions")[0]).length).toBe(5));
});

describe("curl compiler", () => {
  const rows = parseTestStrategy(ISA);
  test("status threshold + HEAD", () => expect(compileCurl(rows[0])).toMatchObject({ url: "https://example.com/", method: "HEAD", expect: { status: 200 }, severity: "critical" }));
  test("contains threshold", () => expect(compileCurl(rows[1])?.expect).toEqual({ contains: "ok", status: 200 }));
  test("header threshold", () => expect(compileCurl(rows[3])?.expect).toEqual({ header: "strict-transport-security" }));
  test("non-curl rows don't compile", () => expect(compileCurl(rows[2])).toBeNull());
});

describe("arbol cron", () => {
  const at = (iso: string) => new Date(iso);
  test("every-N minutes", () => {
    expect(cronMatches("*/30 * * * *", at("2026-10-09T12:30:00Z"))).toBe(true);
    expect(cronMatches("*/30 * * * *", at("2026-10-09T12:31:00Z"))).toBe(false);
  });
  test("fixed minute, stepped hours", () => {
    expect(cronMatches("17 */2 * * *", at("2026-10-09T14:17:00Z"))).toBe(true);
    expect(cronMatches("17 */2 * * *", at("2026-10-09T15:17:00Z"))).toBe(false);
  });
  test("ranges and lists", () => {
    expect(cronMatches("0 9-17 * * 1-5", at("2026-10-09T10:00:00Z"))).toBe(true);   // Friday
    expect(cronMatches("0 9-17 * * 1-5", at("2026-10-10T10:00:00Z"))).toBe(false);  // Saturday
    expect(cronMatches("0,30 * * * *", at("2026-10-09T10:30:00Z"))).toBe(true);
  });
});

test("safeEqual", () => {
  expect(safeEqual("abc", "abc")).toBe(true);
  expect(safeEqual("abc", "abd")).toBe(false);
  expect(safeEqual("abc", "abcd")).toBe(false);
});
