import { describe, expect, test } from "bun:test";
import { sample, scrub, stripTags } from "./MemoryGuards";

describe("scrub", () => {
  // Fixtures are assembled at runtime so no secret-shaped literal sits in the repo (GitHub push protection rightly flags those).
  const p = (...parts: string[]) => parts.join("");
  test.each([
    ["Stripe", p("key sk", "_live_", "abcdefghijklmnopqrstuvwx here")],
    ["Slack", p("token xo", "xb-1234567890-", "abcdefghij")],
    ["Google", p("AI", "zaSyA1234567890abcdefghijklmnopqrstuv")],
    ["JSON camelCase", '{"apiKey":"abc123def456"}'],
    ["JSON snake", '{"api_key": "abc 123 def"}'],
    ["lowercase env", "password = hunter2hunter2"],
    ["quoted value with spaces", 'secret: "two words here"'],
    ["Authorization header", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"],
  ])("%s", (_n, text) => {
    const out = scrub(text);
    expect(out).toContain("[REDACTED]");
    for (const leak of ["abcdefghijklmnop", "abc123def456", "abc 123 def", "hunter2", "two words", "1234567890-abc"]) expect(out).not.toContain(leak);
  });
  test("a whole PEM private key block is removed, including an unterminated one", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq\nZZZZ\n-----END PRIVATE KEY-----";
    expect(scrub(`before ${pem} after`)).toBe("before [REDACTED] after");
    expect(scrub("x -----BEGIN RSA PRIVATE KEY-----\nMIIE...never ended")).not.toContain("MIIE");
  });
  test("ordinary text is left alone", () => expect(scrub("We shipped the router and wrote 12 tests.")).toBe("We shipped the router and wrote 12 tests."));
});

describe("stripTags", () => {
  test("nested tags cannot reassemble into a real closing tag", () => {
    expect(stripTags("a <</evidence>/evidence> b", ["evidence"])).not.toMatch(/<\/evidence>/i);
    expect(stripTags("<<evidence>/evidence>", ["evidence"])).not.toContain("evidence>");
    expect(stripTags("x </ EVIDENCE > y <telos>", ["evidence", "telos"])).toBe("x  y ");
  });
});

describe("sample", () => {
  const log = Array.from({ length: 200 }, (_, i) => JSON.stringify({ n: i })).join("\n");
  test("a .jsonl log is sampled from the END and starts on a whole line", () => {
    const s = sample(log, 200, "MEMORY/LEARNING/a.jsonl");
    expect(s).toContain('{"n":199}'); expect(s).not.toContain('{"n":0}');
    expect(() => s.split("\n").forEach(l => JSON.parse(l))).not.toThrow();
  });
  test("markdown is sampled from the start; short text is returned whole", () => {
    expect(sample("abcdef", 3, "a.md")).toBe("abc"); expect(sample("abc", 10, "a.jsonl")).toBe("abc");
  });
});
