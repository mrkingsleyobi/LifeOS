---
last_updated: 2026-10-09
last_updated_by: da
convention: pai-freshness-v1
version: 1.0.0
---

# Unshipped Registry — what upstream keeps private, and what this install rebuilt

This fork tracks `danielmiessler/LifeOS` at release 7.40.4 (HEAD `5e2f2e8`, identical to upstream on 2026-10-09). Upstream publishes a scrubbed release. Much of the running system stays in the maintainer's private tree. This registry lists every private module, component, and skill the public material reveals, where the evidence is, and what this install now has in its place.

**Evidence sources:** (1) the maintainer's live `CLAUDE.md` routing table (an excerpt the principal supplied), (2) the Pulse nav and `~/.claude/skills` listing from the 2026-09-19 screen recording, (3) "private / release-excluded / not shipped" statements inside the public docs and code, (4) upstream issues and PRs (titles only, see *Limits*).

Status key: **BUILT** = working code here (tested) · **PARTIAL** = runtime here, private integrations still to wire · **DOC** = concept doc only, no code · **ABSENT** = named upstream, nothing public or here.

## 1. Subsystems

| Subsystem | Upstream (public) | Here | Paths | Evidence |
|-----------|-------------------|------|-------|----------|
| **Router v2 / Glance** | RETIRED doc; v2 code private (`LIFEOS/ROUTER/Router.ts`, FrontDoor, LaneQuestions, LaneTrain, RealPrompts) | **BUILT**: Jev front door, 13 lanes, tiered/combo/fusion/fallback/private, hook, statusline | `LIFEOS/ROUTER/*`, `hooks/RouterFrontDoor.hook.ts` | CLAUDE.md; danielmiessler.com/blog/glance-routes-model-and-effort; #1598, #1377 |
| **Decisions** (Jev engine) | ABSENT | **BUILT**: callers, shadow/enforce, drift→shadow, budgets, ledger | `LIFEOS/DECISIONS/*` | CLAUDE.md (`MEMORY/WORK/20260917-jev-across-harness`); #2271 (Decisions block) |
| **Errata** | ABSENT | **BUILT**: ledger, `/er`, Luna enrichment, triage→Upgrades, app intake | `LIFEOS/ERRATA/Errata.ts`, `skills/Errata`, `CLOUDFLARE/workers/errata-intake` | CLAUDE.md; #2165 (SatisfactionCapture English-only) |
| **Socrates** | ABSENT | **BUILT**: STP registry, three-valued answers (Jev or private lane), router → Achilles/Upgrades | `LIFEOS/SOCRATES/Socrates.ts`, Arbol `F_SOCRATES_*` | CLAUDE.md; Pulse `/socrates` tab |
| **Achilles** | ABSENT | **BUILT**: registry, SLA due-pings, CISA KEV sync | `LIFEOS/ACHILLES/Achilles.ts` | CLAUDE.md; Pulse `/achilles`; release 7.40.4 notes (KEV) |
| **Vera** | ABSENT | **BUILT**: claim ledger, as-of projections, diff, gap | `LIFEOS/VERA/Vera.ts` | CLAUDE.md; Pulse `/vera` |
| **People** | ABSENT | **PARTIAL**: store, interactions, customer state, projection, tick. Apple Contacts sync not built (needs macOS Contacts entitlements). | `LIFEOS/PEOPLE/People.ts` | CLAUDE.md (`com.lifeos.people`) |
| **Bunker** | DOC (`Bunker/BunkerSystem.md`); impl `LIFEOS/PULSE/Bunker/**` private | **BUILT**: `bunker test`, `sync-cloud`, cloud health + security planes | `LIFEOS/BUNKER/Bunker.ts`, `CLOUDFLARE/shared/probes.ts`, `workers/bunker-health` | containment-zones.ts; ISAFormat §12 (`Bunker/src/isa.ts`); #2113 |
| **Arbol** | DOC; workers private (`LIFEOS/ARBOL/**`) | **BUILT**: Actions/Pipelines/Flows runtime, lane-aware `A_LLM`, `A_JEV` | `CLOUDFLARE/workers/arbol` | ArbolSystem.md; #2112 |
| **Lockbox** | ABSENT ("designed, NOT built") | **BUILT**: MCP door, 3 scopes, `da.ask`, server-side confirm, tunnel relay | `CLOUDFLARE/workers/lockbox`, `LIFEOS/LOCKBOX/Relay.ts` | CLAUDE.md |
| **Synapse** | DOC + Pulse module; `LIFEOS/SYNAPSE/ISA.md`, capture endpoint `USER/CUSTOMIZATIONS/ARBOL/summarize/`, `com.lifeos.amberroute` private | **BUILT**: amber CLI (write-ahead journal, privacy gate, Jev/private-lane grading, routing) + `amber-ledger` Worker matching the shipped Pulse `/synapse` contract; promoted notes carry `source_amber_id` | `LIFEOS/SYNAPSE/*`, `CLOUDFLARE/workers/amber-ledger` | SynapseSystem.md; BackgroundServices.md; #2245 (`source_amber_id` never written) |
| **Ledger** (`/vb`) | DOC; tooling in the private `_LIFEOS` skill | **BUILT**: `_LIFEOS` skill: classify, bump umbrella + component lines, record, index, commit, tag | `skills/_LIFEOS/Tools/VersionBump.ts`, `commands/vb.md` | LedgerSystem.md |
| **Codex front door** | ABSENT (`LIFEOS/CODEX/Mount.ts`) | **BUILT**: managed AGENTS.md block, skill/prompt symlinks, hooks.json bridge replaying LifeOS hooks | `LIFEOS/CODEX/*`, `TOOLS/lib/HookBridge.ts` | CLAUDE.md; #2263 (Cortex across Codex roots) |
| **Pi front door** | ABSENT (`LIFEOS/PI/Mount.ts`) | **PARTIAL**: APPEND_SYSTEM.md block, managed skills, generated extension shim. The live Pi event field names are unverified. | `LIFEOS/PI/*` | CLAUDE.md |
| **AS3 ISA** | ABSENT (`LIFEOS/AS3/ISA.md`) | **BUILT**: root ISA that rolls up every subsystem ISA. Your own TELOS-level outcome claims are left as fog for you to write. | `LIFEOS/AS3/ISA.md` | CLAUDE.md |
| **Helm / herdr** | ABSENT (kitty layer, `Terminal/kitty/`) | ABSENT (`DOCUMENTATION/Terminal` exists) | — | CLAUDE.md; screen recording |
| **Session restore** (`/rs`) | ABSENT (`TOOLS/Sessions.ts`) | **BUILT**: Claude/Codex/Pi transcripts → live vs restorable → resume | `TOOLS/Sessions.ts`, `commands/rs.md` | CLAUDE.md |
| **Pulse Assistant module** | private | ABSENT (the DA chat surface; Lockbox `da.ask` is the backend it would call) | — | #1173 |
| **Observability (private half)** | loader present, code private | ABSENT | `PULSE/Observability/observability.ts:47` | code comment |

## 2. Pulse dashboard tabs (2026-09-19 recording)

`Gauntlet · Assistant · Algorithm · Bunker · Arbol · Achilles · Helios · Socrates · Vera · Conduit · OPS · REFERENCE`. Public `PULSE/modules/` ships `algorithm-tab`, `bunker`, `conduit`, `synapse`, `hermes` and others.

**BUILT here:**
- **Achilles, Helios, Socrates, Vera, plus Router and Errata**: `PULSE/modules/lifeos-ledgers.ts` + `components/SubsystemView.tsx`. Each tab has its own `[modules]` switch and observer scope.
- **Bunker** now renders. The shipped module calls `PULSE/Bunker/bin/bunker.ts data`, which is a shim to `BUNKER/Bunker.ts`, and `bunker-health` serves its security `/report` and site-health `/status`.

**Still ABSENT:** **Gauntlet** (purpose unknown from public evidence) and **Assistant** (the DA chat surface).

The Bunker header in the recording, `49 BAYS · 1535/1613 ISA PROBES · 4 FLAGGED · 39/39 UPTIME`, is exactly the `GET /status` shape `bunker-health` returns (`bays`, `probes`, `security.flagged`, `uptime`).

## 3. Private hooks, services, tools

| Item | Kind | Evidence |
|------|------|----------|
| `ULWorkSync.hook.ts` | SessionEnd hook, GitHub-Issues work sync | HookSystem.md:108,123. **BUILT** as generic `hooks/WorkSync.hook.ts` (`LIFEOS_WORK_REPO`) |
| `com.lifeos.amberroute` | launchd, Synapse router every 30m | BackgroundServices.md:63. **BUILT** (`InstallSubsystemJobs.ts --only amberroute`) |
| `com.lifeos.bookmark-watchdog` | launchd, X bookmark pipeline watchdog | BackgroundServices.md:64 |
| `com.lifeos.backups` | launchd, daily Git-LFS backup | BackgroundServices.md:65 |
| `com.lifeos.people` | launchd, hourly People tick | CLAUDE.md. **BUILT** (`InstallSubsystemJobs.ts --only people`), plus socrates, achilles-due/kev, errata-enrich, lockbox-relay, bunker-test |
| `BumpSkillVersions` | maintainer tool | skills/LifeOS/SKILL.md:66. **BUILT** inside `_LIFEOS/Tools/VersionBump.ts` |
| `Workflows/TwitterBookmarks.md` | Upgrade skill workflow | skills/Upgrade/SKILL.md:47 |
| Interceptor "Path B" auto-record | designed, not shipped | Interceptor/Workflows/ScrubFlow.md:30 |
| Vector tenant sync | company-tenant overlap with TELOS | Telos/Workflows/Update.md:262 |

## 3a. ISAs (upstream excludes every per-subsystem ISA)

Each subsystem now carries an `ISA.md` whose `## Test Strategy` rows are real commands. `bun LIFEOS/BUNKER/Bunker.ts test --isa <path>` runs them, and `LIFEOS/AS3/ISA.md` is the root that runs every child. As of 2026-10-09: **AS3 17/17**. The 15 children total 51/51 deterministic rows, including deep rows against live Jev, CISA KEV and a public URL. Hand-verified `manual` rows (wrangler dev round-trips) are listed as named exceptions.

`ROUTER · DECISIONS · ERRATA · SOCRATES · ACHILLES · VERA · PEOPLE · SYNAPSE · LOCKBOX · BUNKER · CLOUDFLARE (Arbol + Workers) · CODEX · PI · SESSIONS · LEDGER · AS3`

## 4. Skills

### Public skills in the recording that this release lacks

`AccountPool · ArtDirection · BitterLessonEngineering` (shipped here as `BitterPillEngineering`) `· ComputerUse · Errata` (**BUILT** here) `· Excalidraw` (shipped here as `Tldraw`) `· Gauntlet · Hermes` (sidecar code ships in `LIFEOS/HERMES`, skill doesn't) `· LifeOSHooks · ReadIt · TableTennis · USStats · synced`

### Private `_UNDERSCORE` skills (≈95)

Underscore skills are CONFIDENTIAL by path (`egress-class-core.ts` PATH_CLASS_RULES) and every one is release-excluded. **Purposes below are inferred from names and neighboring evidence. None of them have been read.** Treat this as a build list to fill from your own life, not a description of Daniel's.

| Domain | Skills | Integrates with |
|--------|--------|-----------------|
| Security (Helios) | `_HELIOS`, `_HELIOS_API`, `_HELIOS_BINARY`, `_HELIOS_JAVASCRIPT`, `_HELIOS_MOBILE`, `_HELIOS_PROMPT_INJECTION`, `_HELIOS_WEB`, `_HELIOS_REPORT`, `_RECON`, `_OSINT`, `_VULNMANAGEMENT`, `_INCIDENT_RESPONSE`, `_SECUPDATES`, `_HOMESECURITY`, `_SURVEILLANCE`, `_NETWORK`, `_BOTCHECK` | `agents/Helios.md` (CYBER lane), Achilles, Bunker security plane |
| System / release | `_LIFEOS` (release + UpdateKaiRepo + Ledger `/vb`), `_DOTFILES`, `_HEALTHCHECK`, `_DATAREFRESH`, `_PULSE_SETUP`, `_STATE`, `_PARSER`, `_HERDR`, `_CLOUDFLARE`, `_MERGINGANUBIS` | Ledger, Upgrades, Helm, `CLOUDFLARE/` |
| Business (UL) | `_UL`, `_ULADMIN`, `_ULBAR`, `_ULCOMMUNITY`, `_ULHORMOZI`, `_ULWORK`, `_NEWSLETTER`, `_SUBSTACK`, `_SALES`, `_STRIPE`, `_QUICKBOOKS`, `_EXPENSES`, `_ANNUALREPORTS`, `_GRANTS`, `_HIRING`, `_BENEFITS`, `_OPENSOURCEMANAGEMENT`, `_RL_COMPETITIVE_INTELLIGENCE`, `_IMPACT`, `_INFLUENCE`, `_METRICS` | People (customer state), ULWorkSync, Bunker (commerce plane) |
| Content / media | `_BLOGGING`, `_BROADCAST`, `_BRAND`, `_CANONICALCONTENT`, `_CONTENTSEARCH`, `_SOCIALPOST`, `_X`, `_SHARE`, `_SLIDES`, `_SPEAKING`, `_VIDEO`, `_VIDEOESSAY`, `_STORYEXPLANATION`, `_WRITING`, `_CRITICAL_ANALYSIS`, `_HEADSHOT`, `_STUDIOLIGHTS`, `_MUSIC`, `_SUNO`, `_SPOTIFY`, `_TOME`, `_NEWS`, `_FEED`, `_SURFACE`, `_HARVEST` | Feed, Arbol `P_FEED_DIGEST`, Grok/Gemini lanes (public data) |
| Personal ops | `_CALENDAR`, `_COMMUNICATION`, `_CONTACTS`, `_INBOX`, `_MAKECALLS`, `_RELAY`, `_ORDER`, `_RESTAURANTS`, `_COFFEE`, `_HOME`, `_LIFELOG`, `_PERSONAL`, `_PRIORITIZE`, `_PROFILE`, `_H3`, `_VECTOR`, `_RPG`, `_SHORTCUTS`, `_CRIMESTATS`, `_DATAWASTEWATERCA` | People, Vera, Lockbox (`_RELAY`), **Private lane** for anything personal |

Create each one with `Skill("CreateSkill")` as `_NAME` under `skills/`. The underscore prefix is what keeps it CONFIDENTIAL and out of any release.

## 5. Upstream issues and PRs that touch private modules

Issues: [#2286](https://github.com/danielmiessler/LifeOS/issues/2286) (Resume-After-Complete rewind, open) · [#2271](https://github.com/danielmiessler/LifeOS/issues/2271) (`appendDecisionRow` corrupts Decisions block) · [#2245](https://github.com/danielmiessler/LifeOS/issues/2245) (Synapse `source_amber_id`) · [#2165](https://github.com/danielmiessler/LifeOS/issues/2165) (SatisfactionCapture English-only, open) · [#2142](https://github.com/danielmiessler/LifeOS/issues/2142) (memory proposals CLI-only, open) · [#2038](https://github.com/danielmiessler/LifeOS/issues/2038) (route memory instead of growing it) · [#1957](https://github.com/danielmiessler/LifeOS/issues/1957) (async UserPromptSubmit hooks inert, which shaped the sync Router hook) · [#1598](https://github.com/danielmiessler/LifeOS/issues/1598) (TheRouter leftovers) · [#1425](https://github.com/danielmiessler/LifeOS/issues/1425) (triage gate for weaker models) · [#1377](https://github.com/danielmiessler/LifeOS/issues/1377) (decouple mode/tier classification) · [#1173](https://github.com/danielmiessler/LifeOS/issues/1173) (Pulse Assistant missing) · [#1067](https://github.com/danielmiessler/LifeOS/issues/1067) (llama-server as a router)

PRs: [#2263](https://github.com/danielmiessler/LifeOS/pull/2263) (Cortex recall across Codex roots, open) · [#2113](https://github.com/danielmiessler/LifeOS/pull/2113) (Bunker monitor state in USER tree) · [#2112](https://github.com/danielmiessler/LifeOS/pull/2112) (Arbol scanners by worker keys) · [#2028](https://github.com/danielmiessler/LifeOS/pull/2028), [#1863](https://github.com/danielmiessler/LifeOS/pull/1863) (Hermes) · [#2056](https://github.com/danielmiessler/LifeOS/pull/2056) (multiple entities/roles, relevant to People)

## 6. Limits of this extraction

- **No issue bodies or comments.** This session's network proxy blocks the GitHub REST API, and the GitHub tooling is scoped to this fork. Issue and PR rows above come from GitHub's HTML search pages (titles and state only). To pull bodies and comment threads, run `gh issue list -R danielmiessler/LifeOS --state all --json number,title,body,comments --limit 2500 > upstream-issues.json` on a machine with `gh` and grep it for the subsystem names in §1.
- **Private skill purposes are inferred**, never read. Nothing in §4 is a claim about the maintainer's content.
- **OpenAI model ID strings** (`gpt-6-astra`, `gpt-6.1-sol`, `gpt-5.6-terra`, `gpt-6-luna`) follow the 2026-10 tier-list display names. Confirm them against your OpenAI account's model list and fix `CROSS_VENDOR` in `models.ts` if any differ. That's the only edit point.
