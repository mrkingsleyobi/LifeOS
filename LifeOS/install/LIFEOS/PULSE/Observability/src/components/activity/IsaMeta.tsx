import type { ReactNode } from "react";
import type { IsaMeta } from "@/lib/isa-meta";

// ─── ISA metadata surface (DOCUMENTATION/Pulse/PulseMetadata.md) ───
// Badges: GoalBadge, DensityBadge, ForgeAuditBadge.   Strips: JourneyStrip, CapabilitiesStrip.
// Panels: GoalPanel, DecisionsPanel, VerificationPanel.
// Every piece renders nothing when its field is absent, so older ISAs look exactly as they did before. All text is
// rendered as React text (escaped); nothing here uses dangerouslySetInnerHTML.

const pill = (size: "sm" | "xs") =>
  `inline-flex items-center gap-1 rounded-full border shrink-0 font-semibold tracking-wide ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[10px]"}`;

export function GoalBadge({ meta, size = "sm" }: { meta?: IsaMeta; size?: "sm" | "xs" }) {
  if (!meta?.goal) return null;
  return (
    <span className={`${pill(size)} border-violet-500/25 bg-violet-500/[0.08] text-violet-300`} title={`Goal anchor: ${meta.goal}`} data-testid="goal-badge">
      GOAL
    </span>
  );
}

const RISK_STYLE: Record<string, string> = {
  low: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300",
  medium: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300",
  high: "border-rose-500/25 bg-rose-500/[0.08] text-rose-300",
};

export function DensityBadge({ meta, size = "sm" }: { meta?: IsaMeta; size?: "sm" | "xs" }) {
  if (meta?.densityScore === undefined && !meta?.divergenceRisk) return null;
  const risk = meta.divergenceRisk;
  const score = meta.densityScore !== undefined ? meta.densityScore.toFixed(2) : "";
  return (
    <span
      className={`${pill(size)} ${risk ? RISK_STYLE[risk] : "border-white/10 bg-white/[0.03] text-ink-2"}`}
      title={`Prompt density ${score || "n/a"} · divergence risk ${risk ?? "n/a"}`}
      data-testid="density-badge"
    >
      {score && `D ${score}`}{score && risk ? " · " : ""}{risk ?? ""}
    </span>
  );
}

const VERDICT_STYLE: Record<string, { cls: string; label: string }> = {
  pass: { cls: "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-300", label: "audit ✓" },
  concerns: { cls: "border-amber-500/25 bg-amber-500/[0.08] text-amber-300", label: "audit ⚠" },
  fail: { cls: "border-rose-500/25 bg-rose-500/[0.08] text-rose-300", label: "audit ✕" },
};

export function ForgeAuditBadge({ meta, size = "sm" }: { meta?: IsaMeta; size?: "sm" | "xs" }) {
  const v = meta?.auditVerdict && VERDICT_STYLE[meta.auditVerdict];
  if (!v) return null;
  return <span className={`${pill(size)} ${v.cls}`} title={`Forge audit verdict: ${meta!.auditVerdict}`} data-testid="audit-badge">{v.label}</span>;
}

/** The compact badge cluster for a row; renders nothing at all when there is nothing to show. */
export function IsaMetaBadges({ meta, size = "sm" }: { meta?: IsaMeta; size?: "sm" | "xs" }) {
  if (!meta) return null;
  return (<><GoalBadge meta={meta} size={size} /><DensityBadge meta={meta} size={size} /><ForgeAuditBadge meta={meta} size={size} /></>);
}

/** current_state → ISC progress → ideal_state. Falls back to the dots alone when either endpoint is missing. */
export function JourneyStrip({ meta, done, total }: { meta?: IsaMeta; done: number; total: number }) {
  if (!meta?.currentState && !meta?.idealState) return null;
  const dots = Math.min(total, 24);
  const filled = total > 0 ? Math.round((done / total) * dots) : 0;
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3" data-testid="journey-strip">
      <div className="flex items-start justify-between gap-4 text-[12px]">
        <div className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-ink-3">Current state</div><div className="text-ink-2">{meta.currentState ?? "—"}</div></div>
        <div className="min-w-0 text-right"><div className="text-[10px] uppercase tracking-wider text-ink-3">Ideal state</div><div className="text-ink-2">{meta.idealState ?? "—"}</div></div>
      </div>
      {dots > 0 && (
        <div className="mt-2 flex items-center gap-1" role="img" aria-label={`${done} of ${total} claims verified`}>
          {Array.from({ length: dots }, (_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${i < filled ? "bg-emerald-400" : "border border-white/20"}`} />
          ))}
          <span className="ml-2 text-[11px] text-ink-3">{done}/{total} verified</span>
        </div>
      )}
    </div>
  );
}

export function CapabilitiesStrip({ meta }: { meta?: IsaMeta }) {
  if (!meta?.capabilities?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="capabilities-strip">
      <span className="text-[10px] uppercase tracking-wider text-ink-3 mr-1">Capabilities</span>
      {meta.capabilities.map((c) => (
        <span key={c} className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-px text-[11px] text-ink-2">{c}</span>
      ))}
    </div>
  );
}

function Panel({ title, testid, children }: { title: string; testid: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-3" data-testid={testid}>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-ink-3">{title}</div>
      {children}
    </div>
  );
}

export function GoalPanel({ meta }: { meta?: IsaMeta }) {
  if (!meta?.goal) return null;
  return <Panel title="Goal — what you asked for" testid="goal-panel"><p className="text-sm text-ink-2 leading-snug" data-sensitive>{meta.goal}</p></Panel>;
}

export function DecisionsPanel({ meta }: { meta?: IsaMeta }) {
  if (!meta?.decisions?.length) return null;
  const hidden = (meta.decisionCount ?? meta.decisions.length) - meta.decisions.length;
  return (
    <Panel title={`Decisions (${meta.decisionCount ?? meta.decisions.length})`} testid="decisions-panel">
      <ul className="space-y-1 text-[12px] text-ink-2" data-sensitive>
        {meta.decisions.map((d, i) => (
          <li key={i} className={d.dead ? "text-rose-300/80" : d.refined ? "text-sky-300/90" : ""}>{d.text}</li>
        ))}
      </ul>
      {hidden > 0 && <div className="mt-1 text-[11px] text-ink-3">+{hidden} earlier in the ISA</div>}
    </Panel>
  );
}

export function VerificationPanel({ meta }: { meta?: IsaMeta }) {
  if (!meta?.verification?.length) return null;
  const hidden = (meta.verificationCount ?? meta.verification.length) - meta.verification.length;
  return (
    <Panel title={`Verification (${meta.verificationCount ?? meta.verification.length})`} testid="verification-panel">
      <div className="mb-1"><ForgeAuditBadge meta={meta} size="xs" /></div>
      <ul className="space-y-1 text-[12px] text-ink-2 font-mono" data-sensitive>
        {meta.verification.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {hidden > 0 && <div className="mt-1 text-[11px] text-ink-3">+{hidden} earlier in the ISA</div>}
    </Panel>
  );
}

/** Everything that goes in a tracked run's expanded view, in reading order. Renders nothing when there is no meta. */
export function IsaMetaDetail({ meta, done, total }: { meta?: IsaMeta; done: number; total: number }) {
  if (!meta) return null;
  return (
    <div className="space-y-3" data-testid="isa-meta-detail">
      <JourneyStrip meta={meta} done={done} total={total} />
      <GoalPanel meta={meta} />
      <CapabilitiesStrip meta={meta} />
      <DecisionsPanel meta={meta} />
      <VerificationPanel meta={meta} />
    </div>
  );
}
