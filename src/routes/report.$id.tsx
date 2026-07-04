import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import logoAsset from "@/assets/turbineh-mark.png.asset.json";
import {
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Download,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Clock,
  Target,
  Gauge,
  FileText,
} from "lucide-react";

// -----------------------------------------------------------------------------
// Types matching the get-report Edge Function response
// -----------------------------------------------------------------------------
type Severity = "critical" | "high" | "medium" | "low" | "info";
type Difficulty = "easy" | "medium" | "hard";

interface Finding {
  title: string;
  severity: Severity;
  what_we_detected: string;
  why_it_matters: string;
  business_impact: string;
  recommended_action: string;
  how_to_fix_with_ai: string;
  ai_prompt: string;
  when_to_get_technical_help: string;
  difficulty: Difficulty;
  time_estimate: string;
  priority: number;
}

interface ReportPayload {
  domain: string;
  lang: "es" | "en";
  overall_score: number;
  risk_level: "critical" | "high" | "medium" | "low" | "info";
  model_used?: string | null;
  report: {
    executive_summary: string;
    overall_verdict: string | null;
    top_priorities: { title: string; why_now: string }[];
    start_with_claude: { intro: string; master_prompt: string } | null;
    findings: Finding[];
    action_plan: { next_24h: string[]; next_7d: string[]; next_30d: string[] } | null;
    final_checklist: string[];
    when_to_get_help: string | null;
    disclaimer: string | null;
  };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; data: ReportPayload }
  | { kind: "not_ready"; status?: string }
  | { kind: "not_found" };

export const Route = createFileRoute("/report/$id")({
  component: ReportPage,
});

function ReportPage() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("get-report", {
          body: { scanRequestId: id },
        });
        if (cancelled) return;
        const payload = data as (ReportPayload & { error?: string; status?: string }) | null;
        if (error || !payload) {
          setState({ kind: "not_found" });
          return;
        }
        if (payload.error) {
          if (payload.error === "Report not ready") {
            setState({ kind: "not_ready", status: payload.status });
          } else {
            setState({ kind: "not_found" });
          }
          return;
        }
        setState({ kind: "ok", data: payload });
      } catch {
        if (!cancelled) setState({ kind: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Redirect to /processing when report is still being generated
  useEffect(() => {
    if (state.kind !== "not_ready") return;
    const to = setTimeout(() => {
      navigate({
        to: "/processing/$id",
        params: { id },
        search: { lang } as never,
      });
    }, 1500);
    return () => clearTimeout(to);
  }, [state.kind, navigate, id, lang]);

  if (state.kind === "loading") {
    return (
      <Shell>
        <div className="flex items-center justify-center py-32">
          <div className="flex items-center gap-3 text-[color:var(--brand-muted)]">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>{t("report.loading")}</span>
          </div>
        </div>
      </Shell>
    );
  }

  if (state.kind === "not_ready") {
    return (
      <Shell>
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-xl">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-[color:var(--brand-green-dark)]" />
          <h1 className="mt-4 text-2xl font-bold text-[color:var(--brand-navy)]">
            {t("report.notReadyTitle")}
          </h1>
          <p className="mt-3 text-[color:var(--brand-navy-2)]/70">{t("report.notReadyBody")}</p>
          <Link
            to="/processing/$id"
            params={{ id }}
            search={{ lang } as never}
            className="mt-6 inline-flex rounded-lg bg-[color:var(--brand-navy)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[color:var(--brand-navy-2)]"
          >
            {t("report.goToProcessing")}
          </Link>
        </div>
      </Shell>
    );
  }

  if (state.kind === "not_found") {
    return (
      <Shell>
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-xl">
          <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
          <h1 className="mt-4 text-2xl font-bold text-[color:var(--brand-navy)]">
            {t("report.notFoundTitle")}
          </h1>
          <p className="mt-3 text-[color:var(--brand-navy-2)]/70">{t("report.notFoundBody")}</p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-lg bg-[color:var(--brand-navy)] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[color:var(--brand-navy-2)]"
          >
            {t("report.backHome")}
          </Link>
        </div>
      </Shell>
    );
  }

  return <ReportView id={id} payload={state.data} />;
}

// -----------------------------------------------------------------------------
// Main report view
// -----------------------------------------------------------------------------
function ReportView({ id, payload }: { id: string; payload: ReportPayload }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const { report, domain, overall_score, risk_level } = payload;

  const issuedOn = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString(lang === "en" ? "en-GB" : "es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [lang]);

  const handleDownloadPdf = () => {
    toast(t("report.pdf.soon"));
  };

  return (
    <div className="min-h-screen bg-[color:var(--brand-navy)] text-white">
      {/* Cover */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 20% 0%, color-mix(in oklab, #6FBE44 22%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 90% 20%, color-mix(in oklab, #8FCB3F 18%, transparent) 0%, transparent 55%)",
          }}
        />
        <div className="cyber-grid absolute inset-0 opacity-30" />
        <div className="relative mx-auto max-w-5xl px-6 pb-24 pt-16 md:pt-24">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logoAsset.url} alt="TurbineH" className="h-9 w-auto" />
              <span className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--brand-green-lime)]">
                {t("report.coverKicker")}
              </span>
            </div>
            <Button
              onClick={handleDownloadPdf}
              className="bg-[color:var(--brand-green)] text-[color:var(--brand-navy)] hover:bg-[color:var(--brand-green-lime)]"
            >
              <Download className="h-4 w-4" />
              {t("report.pdf.button")}
            </Button>
          </div>

          <h1 className="mt-14 max-w-3xl text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            {t("report.coverTitle")}
          </h1>
          <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-[color:var(--brand-muted)]">
            <span>
              {t("report.coverFor")}{" "}
              <span className="mono text-white">{domain}</span>
            </span>
            <span className="hidden md:inline">·</span>
            <span>
              {t("report.coverDate")} {issuedOn}
            </span>
          </div>
        </div>
      </section>

      {/* Executive summary + score */}
      <SectionOnDark>
        <SectionHeader kicker={t("report.executiveSummary")} icon={<Sparkles className="h-4 w-4" />} />
        <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto]">
          <div className="rounded-2xl bg-white p-8 text-[color:var(--brand-navy)] shadow-2xl">
            {report.overall_verdict && (
              <p className="text-xl font-semibold leading-snug text-[color:var(--brand-navy)]">
                {report.overall_verdict}
              </p>
            )}
            <p className="mt-4 whitespace-pre-line text-[color:var(--brand-navy-2)]/80">
              {report.executive_summary}
            </p>
          </div>
          <ScoreDial score={overall_score} risk={risk_level} />
        </div>
      </SectionOnDark>

      {/* Start with Claude — HERO action */}
      {report.start_with_claude && (
        <SectionOnDark accent>
          <SectionHeader
            kicker={t("report.claude.section")}
            title={t("report.claude.title")}
            icon={<Sparkles className="h-4 w-4" />}
            hero
          />
          <div className="mt-8 overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="grid gap-0 md:grid-cols-[1.1fr_1fr]">
              <div className="p-8 md:p-10">
                <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--brand-green)]/15 px-3 py-1 text-xs font-semibold text-[color:var(--brand-green-dark)]">
                  {t("report.claude.step1")}
                </div>
                <p className="mt-5 whitespace-pre-line text-[color:var(--brand-navy-2)]">
                  {report.start_with_claude.intro}
                </p>
              </div>
              <div className="border-t border-black/5 bg-[color:var(--brand-navy)] p-6 md:border-l md:border-t-0 md:p-8">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-green-lime)]">
                  {t("report.claude.promptLabel")}
                </div>
                <CopyBox
                  text={report.start_with_claude.master_prompt}
                  copyLabel={t("report.claude.copy")}
                  copiedLabel={t("report.claude.copied")}
                  big
                />
              </div>
            </div>
          </div>
        </SectionOnDark>
      )}

      {/* Top priorities */}
      {report.top_priorities?.length > 0 && (
        <SectionOnDark>
          <SectionHeader
            kicker={t("report.priorities.section")}
            title={t("report.priorities.title", { n: report.top_priorities.length })}
            icon={<Target className="h-4 w-4" />}
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {report.top_priorities.map((p, i) => (
              <div key={i} className="rounded-2xl bg-white p-6 text-[color:var(--brand-navy)] shadow-xl">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--brand-green)] text-sm font-bold text-[color:var(--brand-navy)]">
                    {i + 1}
                  </span>
                  <h3 className="text-base font-semibold leading-tight">{p.title}</h3>
                </div>
                <p className="mt-4 text-sm text-[color:var(--brand-navy-2)]/75">
                  <span className="font-semibold text-[color:var(--brand-navy)]">
                    {t("report.priorities.whyNow")}:
                  </span>{" "}
                  {p.why_now}
                </p>
              </div>
            ))}
          </div>
        </SectionOnDark>
      )}

      {/* Findings */}
      {report.findings?.length > 0 && (
        <SectionOnDark>
          <SectionHeader
            kicker={t("report.findings.section")}
            title={t("report.findings.title")}
            icon={<ShieldAlert className="h-4 w-4" />}
          />
          <div className="mt-8 space-y-6">
            {report.findings.map((f, i) => (
              <FindingCard key={i} finding={f} />
            ))}
          </div>
        </SectionOnDark>
      )}

      {/* Action plan */}
      {report.action_plan && (
        <SectionOnDark>
          <SectionHeader
            kicker={t("report.plan.section")}
            title={t("report.plan.title")}
            icon={<Clock className="h-4 w-4" />}
          />
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <PlanColumn title={t("report.plan.h24")} items={report.action_plan.next_24h} accent="critical" />
            <PlanColumn title={t("report.plan.d7")} items={report.action_plan.next_7d} accent="high" />
            <PlanColumn title={t("report.plan.d30")} items={report.action_plan.next_30d} accent="ok" />
          </div>
        </SectionOnDark>
      )}

      {/* Final checklist */}
      {report.final_checklist?.length > 0 && (
        <SectionOnDark>
          <SectionHeader
            kicker={t("report.checklist.section")}
            title={t("report.checklist.title")}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <div className="mt-8 rounded-2xl bg-white p-6 text-[color:var(--brand-navy)] shadow-xl md:p-8">
            <ul className="space-y-3">
              {report.final_checklist.map((item, i) => (
                <ChecklistItem key={i} text={item} idx={i} />
              ))}
            </ul>
          </div>
        </SectionOnDark>
      )}

      {/* When to get help */}
      {report.when_to_get_help && (
        <SectionOnDark>
          <SectionHeader kicker={t("report.help.section")} title={t("report.help.title")} />
          <div className="mt-6 rounded-2xl bg-white p-8 text-[color:var(--brand-navy)] shadow-xl">
            <p className="whitespace-pre-line text-[color:var(--brand-navy-2)]/85">
              {report.when_to_get_help}
            </p>
          </div>
        </SectionOnDark>
      )}

      {/* Disclaimer */}
      {report.disclaimer && (
        <SectionOnDark>
          <SectionHeader kicker={t("report.disclaimer.section")} title={t("report.disclaimer.title")} />
          <div className="mt-6 rounded-2xl border border-white/10 bg-[color:var(--brand-navy-2)] p-6 text-sm text-[color:var(--brand-muted)]">
            <p className="whitespace-pre-line">{report.disclaimer}</p>
          </div>
        </SectionOnDark>
      )}

      {/* Footer CTA */}
      <div className="mx-auto max-w-5xl px-6 pb-20">
        <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[color:var(--brand-navy-2)] p-6 md:flex-row">
          <div className="flex items-center gap-3 text-sm text-[color:var(--brand-muted)]">
            <FileText className="h-5 w-5" />
            {t("report.pdf.soon")}
          </div>
          <Button
            onClick={handleDownloadPdf}
            className="bg-[color:var(--brand-green)] text-[color:var(--brand-navy)] hover:bg-[color:var(--brand-green-lime)]"
          >
            <Download className="h-4 w-4" />
            {t("report.pdf.button")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[color:var(--brand-navy)] text-white">
      <div className="mx-auto max-w-5xl px-6 py-20">{children}</div>
    </div>
  );
}

function SectionOnDark({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <section className={accent ? "bg-[color:var(--brand-navy-2)]" : ""}>
      <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">{children}</div>
    </section>
  );
}

function SectionHeader({
  kicker,
  title,
  icon,
  hero = false,
}: {
  kicker: string;
  title?: string;
  icon?: React.ReactNode;
  hero?: boolean;
}) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--brand-green)]/40 bg-[color:var(--brand-green)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-green-lime)]">
        {icon}
        {kicker}
      </div>
      {title && (
        <h2
          className={
            hero
              ? "mt-4 text-3xl font-bold tracking-tight md:text-4xl"
              : "mt-3 text-2xl font-bold tracking-tight md:text-3xl"
          }
        >
          {title}
        </h2>
      )}
    </div>
  );
}

function ScoreDial({ score, risk }: { score: number; risk: ReportPayload["risk_level"] }) {
  const { t } = useTranslation();
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const size = 200;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const color = scoreColor(clamped);
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-white p-8 text-[color:var(--brand-navy)] shadow-2xl">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(15,29,46,0.08)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 800ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-5xl font-bold leading-none">{clamped}</div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-[color:var(--brand-navy-2)]/60">
            {t("report.scoreOutOf")}
          </div>
        </div>
      </div>
      <div
        className="mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold"
        style={{
          background: `color-mix(in oklab, ${color} 15%, transparent)`,
          color,
        }}
      >
        <Gauge className="h-4 w-4" />
        {t(`report.risk.${risk}` as const)}
      </div>
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return "#3E9A34";
  if (score >= 60) return "#6FBE44";
  if (score >= 40) return "#E1A100";
  if (score >= 20) return "#E77F00";
  return "#D6371F";
}

function severityStyle(sev: Severity): { bg: string; fg: string; label: string } {
  switch (sev) {
    case "critical":
      return { bg: "#FDECEC", fg: "#B2261A", label: "critical" };
    case "high":
      return { bg: "#FDEEDD", fg: "#B65A00", label: "high" };
    case "medium":
      return { bg: "#FFF6D8", fg: "#8A6A00", label: "medium" };
    case "low":
      return { bg: "#E6F3D9", fg: "#3E9A34", label: "low" };
    default:
      return { bg: "#E4EAF2", fg: "#16283C", label: "info" };
  }
}

function FindingCard({ finding }: { finding: Finding }) {
  const { t } = useTranslation();
  const sev = severityStyle(finding.severity);
  return (
    <article className="overflow-hidden rounded-2xl bg-white text-[color:var(--brand-navy)] shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 p-6 md:p-8">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-navy-2)]/50">
            #{finding.priority}
          </div>
          <h3 className="mt-2 text-xl font-bold leading-snug md:text-2xl">{finding.title}</h3>
        </div>
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider"
          style={{ background: sev.bg, color: sev.fg }}
        >
          {t(`report.findings.sev.${sev.label}` as const)}
        </span>
      </header>

      <div className="grid gap-6 p-6 md:grid-cols-2 md:p-8">
        <FindingBlock title={t("report.findings.detected")} body={finding.what_we_detected} />
        <FindingBlock title={t("report.findings.whyMatters")} body={finding.why_it_matters} />
        <FindingBlock title={t("report.findings.impact")} body={finding.business_impact} />
        <FindingBlock title={t("report.findings.action")} body={finding.recommended_action} />
      </div>

      <div className="border-t border-black/5 bg-[color:var(--brand-navy)] p-6 text-white md:p-8">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-green-lime)]">
          <Sparkles className="h-4 w-4" />
          {t("report.findings.howClaude")}
        </div>
        <p className="mt-3 text-sm text-white/85">{finding.how_to_fix_with_ai}</p>
        <div className="mt-5 text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-muted)]">
          {t("report.findings.promptLabel")}
        </div>
        <div className="mt-2">
          <CopyBox
            text={finding.ai_prompt}
            copyLabel={t("report.findings.copy")}
            copiedLabel={t("report.findings.copied")}
          />
        </div>
      </div>

      <div className="p-6 md:p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-navy-2)]/50">
          {t("report.findings.help")}
        </div>
        <p className="mt-2 text-sm text-[color:var(--brand-navy-2)]/80">
          {finding.when_to_get_technical_help}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Chip label={t("report.findings.difficulty")} value={t(`report.findings.diff.${finding.difficulty}` as const)} />
          <Chip label={t("report.findings.time")} value={finding.time_estimate} />
          <Chip label={t("report.findings.priority")} value={`#${finding.priority}`} />
        </div>
      </div>
    </article>
  );
}

function FindingBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--brand-navy-2)]/50">
        {title}
      </h4>
      <p className="mt-2 text-sm leading-relaxed text-[color:var(--brand-navy-2)]/85">{body}</p>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--brand-navy)]/10 bg-[color:var(--brand-navy)]/5 px-3 py-1 text-xs">
      <span className="font-semibold text-[color:var(--brand-navy-2)]/60">{label}:</span>
      <span className="font-semibold text-[color:var(--brand-navy)]">{value}</span>
    </span>
  );
}

function PlanColumn({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: "critical" | "high" | "ok";
}) {
  const barColor =
    accent === "critical" ? "#D6371F" : accent === "high" ? "#E77F00" : "#3E9A34";
  return (
    <div className="rounded-2xl bg-white p-6 text-[color:var(--brand-navy)] shadow-xl">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: barColor }} />
        <h3 className="text-sm font-bold uppercase tracking-wider">{title}</h3>
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((it, i) => (
          <li key={i} className="flex gap-3 text-sm text-[color:var(--brand-navy-2)]/85">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--brand-green)]" />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChecklistItem({ text, idx }: { text: string; idx: number }) {
  const [checked, setChecked] = useState(false);
  const id = `chk-${idx}`;
  return (
    <li className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => setChecked(!!v)} className="mt-0.5" />
      <label
        htmlFor={id}
        className={
          "cursor-pointer text-sm leading-relaxed " +
          (checked
            ? "text-[color:var(--brand-navy-2)]/40 line-through"
            : "text-[color:var(--brand-navy-2)]/85")
        }
      >
        {text}
      </label>
    </li>
  );
}

function CopyBox({
  text,
  copyLabel,
  copiedLabel,
  big = false,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  big?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Clipboard error");
    }
  }, [text]);
  return (
    <div className="relative rounded-xl border border-white/10 bg-black/30 p-4">
      <pre
        className={
          "mono whitespace-pre-wrap break-words pr-2 text-white/90 " +
          (big ? "text-sm leading-relaxed" : "text-xs leading-relaxed")
        }
      >
        {text}
      </pre>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={onCopy}
          className={
            copied
              ? "bg-[color:var(--brand-green-dark)] text-white hover:bg-[color:var(--brand-green-dark)]"
              : "bg-[color:var(--brand-green)] text-[color:var(--brand-navy)] hover:bg-[color:var(--brand-green-lime)]"
          }
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  );
}
