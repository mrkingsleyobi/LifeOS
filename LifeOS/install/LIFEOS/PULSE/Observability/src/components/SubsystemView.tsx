"use client";

/**
 * SubsystemView — renders the generic View payload served by
 * modules/lifeos-ledgers.ts (Router, Achilles, Helios, Socrates, Vera, Errata).
 * Holds zero data logic: the module shapes everything; this only lays it out.
 */

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Panel, PanelHeader, Pill, StatTile, type Dim } from "@/components/ui/chrome";

interface View {
  title: string;
  subtitle: string;
  generated_at: string;
  stats: { label: string; value: string | number; sub?: string; dim?: Dim }[];
  sections: { title: string; columns: string[]; rows: { cells: (string | number)[]; dim?: Dim }[]; empty?: string }[];
}

export default function SubsystemView({ endpoint, title, icon }: { endpoint: string; title: string; icon: LucideIcon }) {
  const [data, setData] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(endpoint)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => { if (alive) { setData(j); setError(null); } })
        .catch((e) => alive && setError(String(e)));
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [endpoint]);

  if (error) {
    return (
      <PageShell>
        <PageHeader title={title} icon={icon} />
        <EmptyState icon={icon} title={`${title} API unreachable`} hint={error} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title={data?.title ?? title} icon={icon} subtitle={data?.subtitle} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        {(data?.stats ?? []).map((s) => (
          <StatTile key={s.label} label={s.label} value={s.value} sub={s.sub} dim={s.dim} />
        ))}
      </div>
      {(data?.sections ?? []).map((sec) => (
        <Panel key={sec.title} className="mb-4">
          <PanelHeader title={sec.title} meta={`${sec.rows.length}`} />
          {sec.rows.length === 0 ? (
            <EmptyState title={sec.empty ?? "Nothing yet"} />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {sec.columns.map((c) => (
                      <th key={c} style={{ textAlign: "left", padding: "6px 10px", color: "var(--ink-3)", fontWeight: 500, whiteSpace: "nowrap" }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--line, rgba(127,127,127,.15))" }}>
                      {r.cells.map((c, j) => (
                        <td key={j} style={{ padding: "6px 10px", verticalAlign: "top" }}>
                          {j === 0 && r.dim ? <Pill dim={r.dim}>{String(c)}</Pill> : String(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ))}
    </PageShell>
  );
}
