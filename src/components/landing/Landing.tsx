import logoAsset from "@/assets/turbineh-mark.png.asset.json";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { LangToggle } from "@/components/LangToggle";
import { normalizeDomain, validateDomain } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { SampleReportButton } from "@/components/SampleReportButton";
import {
  Shield,
  Mail,
  Cookie,
  Lock,
  Cpu,
  FileText,
  FileWarning,
  KeyRound,
  Globe,
  Clock,
  // Wallet removed
  Sparkles,
  Check,
  ArrowRight,
  ChevronDown,
  X,
} from "lucide-react";

const CARD_KEYS = [
  "headers",
  "dmarc",
  "cookies",
  "ssl",
  "tech",
  "forms",
  "csp",
  "admin",
  "dns",
] as const;

const CARD_ICONS: Record<(typeof CARD_KEYS)[number], React.ComponentType<{ className?: string }>> = {
  headers: Shield,
  dmarc: Mail,
  cookies: Cookie,
  ssl: Lock,
  tech: Cpu,
  forms: FileText,
  csp: FileWarning,
  admin: KeyRound,
  dns: Globe,
};

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Landing() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const navigate = useNavigate();

  const [rawDomain, setRawDomain] = useState("");
  const [normalized, setNormalized] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [lead, setLead] = useState<Lead>({ name: "", phone: "", email: "", company: "" });
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);


  // Random subset of preview cards, stable per domain
  const previewCards = useMemo(() => {
    if (!normalized) return [];
    // deterministic-ish shuffle seeded by domain
    let seed = 0;
    for (const c of normalized) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const count = 3 + Math.floor(rand() * 5); // 3–7
    const pool = [...CARD_KEYS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
  }, [normalized]);

  const handleAnalyze = (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = normalizeDomain(rawDomain);
    const err = validateDomain(n);
    if (err) {
      setInputError(t(`domainInput.errors.${err}`));
      setNormalized(null);
      return;
    }
    setInputError(null);
    setNormalized(n);
    setRawDomain(n);
    trackEvent("domain_submitted", { lang, meta: { domain: n } });
    // Fire-and-forget lead notification (never block preview)
    try {
      void supabase.functions
        .invoke("notify-lead", {
          body: { type: "domain_submitted", domain: n, lang },
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
    setTimeout(() => scrollToId("preview"), 60);
  };

  // Fire landing_view once on mount
  useEffect(() => {
    trackEvent("landing_view", { lang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fire preview_shown when a preview is rendered for a normalized domain
  useEffect(() => {
    if (normalized) {
      trackEvent("preview_shown", { lang, meta: { domain: normalized } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);

  const handleFreeStart = async () => {
    const domain = normalized ?? normalizeDomain(rawDomain);
    if (!domain || validateDomain(domain)) {
      setCheckoutError(t("paywall.domainRequired"));
      scrollToId("domain-input");
      return;
    }
    const name = lead.name.trim();
    const phone = lead.phone.trim();
    const company = lead.company.trim();
    const mail = lead.email.trim();
    if (!name) {
      setCheckoutError(t("paywall.nameRequired"));
      return;
    }
    if (!mail) {
      setCheckoutError(t("paywall.emailRequired"));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setCheckoutError(t("paywall.emailInvalid"));
      return;
    }
    if (!phone) {
      setCheckoutError(t("paywall.phoneRequired"));
      return;
    }
    if (!/^[+()\d\s.-]{6,20}$/.test(phone)) {
      setCheckoutError(t("paywall.phoneInvalid"));
      return;
    }
    if (!company) {
      setCheckoutError(t("paywall.companyRequired"));
      return;
    }
    setCheckoutError(null);
    setCheckoutLoading(true);
    trackEvent("unlock_clicked", { lang, meta: { domain } });
    try {
      const { data, error } = await supabase.functions.invoke("start-free-diagnosis", {
        body: { domain, email: mail, name, phone, company, lang },
      });
      const payload = data as { scanRequestId?: string; error?: string } | null;
      if (error || !payload?.scanRequestId) {
        setCheckoutError(t("paywall.error"));
        setCheckoutLoading(false);
        return;
      }
      navigate({
        to: "/verify/$id",
        params: { id: payload.scanRequestId },
        search: { lang } as never,
      });
    } catch {
      setCheckoutError(t("paywall.error"));
      setCheckoutLoading(false);
    }
  };


  // Reveal-on-scroll for elements with `.reveal`
  useEffect(() => {
    if (typeof window === "undefined") return;
    const els = document.querySelectorAll<HTMLElement>(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [normalized]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <Header />
      <main>
        <Hero
          raw={rawDomain}
          setRaw={setRawDomain}
          onSubmit={handleAnalyze}
          error={inputError}
        />
        <HowItWorks />
        {normalized && (
          <PreviewSection
            domain={normalized}
            cardKeys={previewCards}
            lead={lead}
            setLead={setLead}
            onStart={handleFreeStart}
            loading={checkoutLoading}
            errorMsg={checkoutError}
          />
        )}
        <Paywall
          lead={lead}
          setLead={setLead}

          onCheckout={handleFreeStart}
          loading={checkoutLoading}
          errorMsg={checkoutError}
        />

        <AiSection domain={normalized ?? (lang === "en" ? "yourdomain.com" : "midominio.com")} />
        <WhatIsExposure />
        <WhatWeCheck />
        <DiagnosisVsPentest />
        <WhoItsFor />
        <FAQ />
        <LegalDisclaimer />
        <TurbineHSection />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------- SCROLL PROGRESS ---------------- */
function ScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setP(max > 0 ? (h.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-0.5 bg-transparent"
    >
      <div
        className="h-full bg-gradient-to-r from-brand via-brand-2 to-cta transition-[width] duration-150"
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

/* ---------------- HEADER ---------------- */
function Header() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <a href="#top" className="flex items-center gap-2">
          <img
            src={logoAsset.url}
            alt="TurbineH Security"
            width={32}
            height={32}
            className="h-8 w-8 shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight">
            TurbineH <span className="text-muted-foreground font-medium">Security</span>
          </span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground transition">{t("nav.how")}</a>
          <a href="#what" className="hover:text-foreground transition">{t("nav.what")}</a>
          <a href="#pricing" className="hover:text-foreground transition">{t("nav.pricing")}</a>
          <a href="#faq" className="hover:text-foreground transition">{t("nav.faq")}</a>
        </nav>
        <div className="flex items-center gap-2">
          <LangToggle />
          <button
            onClick={() => scrollToId("domain-input")}
            className="hidden md:inline-flex items-center gap-1.5 rounded-lg bg-cta px-3.5 py-2 text-sm font-semibold text-cta-foreground shadow-sm shadow-cta/20 hover:brightness-110 transition"
          >
            {t("nav.cta")} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------- HERO ---------------- */
function Hero({
  raw,
  setRaw,
  onSubmit,
  error,
}: {
  raw: string;
  setRaw: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 cyber-grid" />
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-40 right-0 h-[300px] w-[300px] rounded-full bg-brand-2/10 blur-3xl" />
        <div className="scan-line" />
      </div>
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-20 md:px-6 md:pt-24 md:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
            {t("hero.title")}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
            {t("hero.subtitle")}
          </p>
        </div>


        <div id="domain-input" className="mx-auto mt-10 max-w-2xl">
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-lg shadow-brand/5 sm:flex-row sm:items-center sm:p-2"
          >
            <div className="relative flex-1">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={t("domainInput.placeholder") as string}
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full rounded-xl bg-transparent py-3 pl-10 pr-3 text-base outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground shadow-sm hover:brightness-110 transition"
            >
              {t("domainInput.button")} <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          {error && (
            <p className="mt-2 pl-2 text-sm text-destructive">{error}</p>
          )}
          <div className="mt-4 flex justify-center">
            <SampleReportButton />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-brand" /> {t("hero.reassure.minutes")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-brand" /> {t("hero.reassure.once")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" /> {t("hero.reassure.notech")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- HOW ---------------- */
function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    { icon: Globe, label: t("how.s1") },
    { icon: Shield, label: t("how.s2") },
    { icon: FileText, label: t("how.s3") },
    { icon: Sparkles, label: t("how.s4") },
  ];
  return (
    <section id="how" className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
          {t("how.title")}
        </h2>
        <div className="relative mx-auto mt-12 max-w-5xl">
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-16 hidden h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent md:block"
          />
          <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-4">
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <li
                  key={i}
                  className="reveal group relative rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand/15 to-brand-2/15 text-brand ring-1 ring-brand/20">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-1 text-base font-semibold leading-snug">{s.label}</div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ---------------- PREVIEW ---------------- */
const CARD_SEVERITY: Record<(typeof CARD_KEYS)[number], "critical" | "high" | "medium" | "low"> = {
  dmarc: "critical",
  admin: "critical",
  headers: "high",
  ssl: "high",
  csp: "high",
  cookies: "medium",
  forms: "medium",
  dns: "medium",
  tech: "low",
};

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

const SEV_STYLES: Record<
  "critical" | "high" | "medium" | "low",
  { badge: string; bar: string; dot: string; ring: string; text: string }
> = {
  critical: {
    badge: "bg-red-500/10 text-red-500 border-red-500/30",
    bar: "bg-red-500",
    dot: "bg-red-500 shadow-[0_0_10px_theme(colors.red.500)]",
    ring: "ring-red-500/30",
    text: "text-red-500",
  },
  high: {
    badge: "bg-orange-500/10 text-orange-500 border-orange-500/30",
    bar: "bg-orange-500",
    dot: "bg-orange-500 shadow-[0_0_10px_theme(colors.orange.500)]",
    ring: "ring-orange-500/25",
    text: "text-orange-500",
  },
  medium: {
    badge: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    bar: "bg-yellow-500",
    dot: "bg-yellow-500 shadow-[0_0_10px_theme(colors.yellow.500)]",
    ring: "ring-yellow-500/25",
    text: "text-yellow-500",
  },
  low: {
    badge: "bg-sky-500/10 text-sky-500 border-sky-500/30",
    bar: "bg-sky-500",
    dot: "bg-sky-500 shadow-[0_0_10px_theme(colors.sky.500)]",
    ring: "ring-sky-500/20",
    text: "text-sky-500",
  },
};

export type Lead = { name: string; phone: string; email: string; company: string };

/* ---------------- LEAD FORM ---------------- */
function LeadForm({
  lead,
  setLead,
  onSubmit,
  loading,
  errorMsg,
  compact,
}: {
  lead: Lead;
  setLead: (v: Lead) => void;
  onSubmit: () => void;
  loading: boolean;
  errorMsg: string | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const field =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
  const set = (k: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setLead({ ...lead, [k]: e.target.value });

  const fields: { k: keyof Lead; label: string; ph: string; type: string; auto: string }[] = [
    { k: "name", label: "nameLabel", ph: "namePlaceholder", type: "text", auto: "name" },
    { k: "company", label: "companyLabel", ph: "companyPlaceholder", type: "text", auto: "organization" },
    { k: "email", label: "emailLabel", ph: "emailPlaceholder", type: "email", auto: "email" },
    { k: "phone", label: "phoneLabel", ph: "phonePlaceholder", type: "tel", auto: "tel" },
  ];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
      className="space-y-4"
    >
      <div>
        <h3 className="text-base font-semibold tracking-tight">{t("paywall.formTitle")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("paywall.formHint")}</p>
      </div>
      <div className={compact ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 sm:grid-cols-2"}>
        {fields.map((f) => (
          <div key={f.k}>
            <label
              htmlFor={`lead-${compact ? "b" : "a"}-${f.k}`}
              className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {t(`paywall.${f.label}`)} <span className="text-cta">*</span>
            </label>
            <input
              id={`lead-${compact ? "b" : "a"}-${f.k}`}
              type={f.type}
              required
              autoComplete={f.auto}
              maxLength={120}
              value={lead[f.k]}
              onChange={set(f.k)}
              placeholder={t(`paywall.${f.ph}`) as string}
              className={`mt-1.5 ${field}`}
            />
          </div>
        ))}
      </div>
      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-md shadow-cta/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-cta-foreground/40 border-t-cta-foreground" />
            {t("paywall.buttonLoading")}
          </>
        ) : (
          <>
            {t("paywall.button")} <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      {errorMsg && (
        <p role="alert" className="text-sm text-destructive">
          {errorMsg}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{t("paywall.secure")}</p>
    </form>
  );
}

function PreviewSection({
  domain,
  cardKeys,
  lead,
  setLead,
  onStart,
  loading,
  errorMsg,
}: {
  domain: string;
  cardKeys: readonly (typeof CARD_KEYS)[number][];
  lead: Lead;
  setLead: (v: Lead) => void;
  onStart: () => void;
  loading: boolean;
  errorMsg: string | null;
}) {

  const { t } = useTranslation();

  // Sort by severity to compute priority numbers
  const ranked = useMemo(() => {
    return [...cardKeys]
      .sort((a, b) => SEV_ORDER[CARD_SEVERITY[a]] - SEV_ORDER[CARD_SEVERITY[b]])
      .map((k, i) => ({ k, priority: i + 1, severity: CARD_SEVERITY[k] }));
  }, [cardKeys]);

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    ranked.forEach((r) => c[r.severity]++);
    return c;
  }, [ranked]);

  // Deterministic report id + timestamp from domain
  const reportId = useMemo(() => {
    let h = 0;
    for (const c of domain) h = (h * 33 + c.charCodeAt(0)) >>> 0;
    return "TH-" + h.toString(16).toUpperCase().padStart(8, "0").slice(0, 8);
  }, [domain]);

  const total = ranked.length;
  const totalWeight = total * 3; // max sev weight per finding = 3
  const currentWeight = counts.critical * 3 + counts.high * 2 + counts.medium * 1.2 + counts.low * 0.5;
  const exposurePct = Math.min(100, Math.round((currentWeight / Math.max(totalWeight, 1)) * 100));

  return (
    <section id="preview" className="scroll-mt-24 border-t border-border/60 bg-gradient-to-b from-background to-background/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        {/* Report header */}
        <div className="reveal overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur cyber-border">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-red-500/70" />
              <span className="inline-flex h-2 w-2 rounded-full bg-yellow-500/70" />
              <span className="inline-flex h-2 w-2 rounded-full bg-green-500/70" />
              <span className="ml-3">turbineh://scan/{domain}</span>
            </div>
            <span className="hidden sm:inline">{t("preview.reportId")}: {reportId}</span>
          </div>
          <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="font-mono text-xs text-muted-foreground">{t("preview.scannedAt")} · {new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
                {t("preview.headingFor")} <span className="text-brand">{domain}</span>
              </h2>
              <div className="mt-1 text-sm text-muted-foreground">
                {total} {t("preview.findings")}
              </div>
            </div>
            <div className="min-w-[220px]">
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>{t("preview.summary")}</span>
                <span className={exposurePct >= 66 ? "text-red-500" : exposurePct >= 33 ? "text-orange-500" : "text-yellow-500"}>{exposurePct}%</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {(["critical", "high", "medium", "low"] as const).map((s) =>
                  counts[s] ? (
                    <div
                      key={s}
                      className={`${SEV_STYLES[s].bar} h-full`}
                      style={{ width: `${(counts[s] / total) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium">
                {(["critical", "high", "medium", "low"] as const).map((s) => (
                  <span
                    key={s}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ${SEV_STYLES[s].badge}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${SEV_STYLES[s].dot}`} />
                    {t(`preview.severity.${s}`)} · {counts[s]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-6 max-w-4xl rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-foreground/80">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 shrink-0 text-brand" />
            <p>{t("preview.disclaimer")}</p>
          </div>
        </div>

        {/* Findings list */}
        <ol className="mt-8 space-y-3">
          {ranked.map(({ k, priority, severity }) => {
            const Icon = CARD_ICONS[k];
            const s = SEV_STYLES[severity];
            return (
              <li
                key={k}
                className={`reveal group relative overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 shadow-sm ring-1 ${s.ring} transition hover:-translate-y-0.5 hover:shadow-md md:p-5 md:pl-6`}
              >
                <div className={`absolute inset-y-0 left-0 w-1.5 ${s.bar}`} />
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  {/* Priority number */}
                  <div className="flex items-center gap-4 md:w-40 md:shrink-0">
                    <div className="flex flex-col items-center">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("preview.priority")}
                      </div>
                      <div className={`font-mono text-3xl font-bold leading-none ${s.text}`}>
                        {String(priority).padStart(2, "0")}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${s.badge}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {t(`preview.severity.${severity}`)}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="flex-1">
                    <div className="flex items-start gap-3">
                      <div className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ${s.text}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold leading-snug">
                          {t(`preview.cards.${k}.t`)}
                        </h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {t(`preview.cards.${k}.d`)}
                        </p>
                        <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                          {t("preview.status")}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mx-auto mt-10 max-w-3xl text-center text-sm text-muted-foreground">
          {t("preview.closing")}
        </p>
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          <LeadForm
            lead={lead}
            setLead={setLead}
            onSubmit={onStart}
            loading={loading}
            errorMsg={errorMsg}
          />
        </div>

      </div>
    </section>
  );
}

/* ---------------- PAYWALL ---------------- */
function Paywall({
  lead,
  setLead,
  onCheckout,
  loading,
  errorMsg,
}: {
  lead: Lead;
  setLead: (v: Lead) => void;
  onCheckout: () => void;
  loading: boolean;
  errorMsg: string | null;
}) {

  const { t } = useTranslation();
  const bullets = t("paywall.bullets", { returnObjects: true }) as string[];
  return (
    <section id="pricing" className="scroll-mt-24 border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-4xl px-4 py-16 md:px-6 md:py-24">
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-xl shadow-brand/5">
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr,1fr]">
            <div className="p-8 md:p-10">
              <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
                {t("paywall.badge")}
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                {t("paywall.title")}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">{t("paywall.value")}</p>
              <div className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("paywall.includes")}
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-border bg-gradient-to-br from-brand/5 to-brand-2/5 p-8 md:border-l md:border-t-0 md:p-10">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-tight text-brand">0 €</span>
                <span className="text-sm text-muted-foreground">/ {t("hero.reassure.once")}</span>
              </div>
              <div className="mt-6 space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("paywall.emailLabel")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("paywall.emailPlaceholder") as string}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={onCheckout}
                  disabled={loading}
                  aria-busy={loading}
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-5 py-3.5 text-sm font-semibold text-cta-foreground shadow-md shadow-cta/20 hover:brightness-110 transition disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cta-foreground/40 border-t-cta-foreground" />
                      {t("paywall.buttonLoading")}
                    </>
                  ) : (
                    <>
                      {t("paywall.button")} <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                {errorMsg && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {errorMsg}
                  </p>
                )}
                <SampleReportButton className="w-full" />
                <p className="text-xs text-muted-foreground">{t("paywall.secure")}</p>



              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- AI ---------------- */
function AiSection({ domain }: { domain: string }) {
  const { t } = useTranslation();
  const prompt = (t("ai.prompt") as string).replace("{dominio}", domain).replace("{domain}", domain);
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:px-6 md:py-24">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <Sparkles className="h-3.5 w-3.5" /> AI
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">{t("ai.title")}</h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">{t("ai.body")}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("ai.promptLabel")}
          </div>
          <div className="mt-3 rounded-2xl border border-border bg-[oklch(0.18_0.02_260)] p-5 shadow-lg">
            <div className="mb-3 flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-slate-100">
              {prompt}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- WHAT IS EXPOSURE ---------------- */
function WhatIsExposure() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center md:px-6 md:py-24">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
          {t("what.exposureTitle")}
        </h2>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground md:text-lg">
          {t("what.exposureBody")}
        </p>
      </div>
    </section>
  );
}

/* ---------------- WHAT WE CHECK ---------------- */
function WhatWeCheck() {
  const { t } = useTranslation();
  const items = t("what.items", { returnObjects: true }) as string[];
  return (
    <section id="what" className="scroll-mt-24 border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
          {t("what.checkTitle")}
        </h2>
        <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span className="text-sm">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- VS PENTEST ---------------- */
function DiagnosisVsPentest() {
  const { t } = useTranslation();
  const col1 = t("vs.col1", { returnObjects: true }) as string[];
  const col2 = t("vs.col2", { returnObjects: true }) as string[];
  return (
    <section className="border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-5xl px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("vs.title")}</h2>
          <p className="mt-4 text-base text-muted-foreground">{t("vs.body")}</p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border-2 border-brand/40 bg-card p-6 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              {t("vs.col1t")}
            </div>
            <ul className="mt-4 space-y-2">
              {col1.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
              {t("vs.col2t")}
            </div>
            <ul className="mt-4 space-y-2">
              {col2.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <X className="mt-0.5 h-4 w-4 shrink-0" /> {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- WHO ---------------- */
function WhoItsFor() {
  const { t } = useTranslation();
  const items = t("who.items", { returnObjects: true }) as string[];
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-5xl px-4 py-16 text-center md:px-6 md:py-20">
        <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("who.title")}</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {items.map((i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium"
            >
              {i}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- FAQ ---------------- */
function FAQ() {
  const { t } = useTranslation();
  const items = t("faq.items", { returnObjects: true }) as { q: string; a: string }[];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="scroll-mt-24 border-t border-border/60 bg-muted/30">
      <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-24">
        <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
          {t("faq.title")}
        </h2>
        <div className="mt-10 space-y-3">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-sm font-semibold md:text-base">{it.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------- LEGAL ---------------- */
function LegalDisclaimer() {
  const { t } = useTranslation();
  return (
    <section className="border-t border-border/60">
      <div className="mx-auto max-w-4xl px-4 py-12 md:px-6">
        <div className="rounded-2xl border border-border bg-muted/40 p-6 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-2 font-semibold uppercase tracking-wider text-foreground/70">
            Disclaimer
          </div>
          {t("legal.disclaimer")}
        </div>
      </div>
    </section>
  );
}

/* ---------------- TURBINEH COMPANY ---------------- */
const CALENDLY_URL = "https://calendly.com/alejandroruiz3c/turbineh-alex-ruiz";

function TurbineHSection() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const blocks = t("turbineh.blocks", { returnObjects: true }) as { t: string; d: string }[];
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleBook = () => {
    const mail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError(t("turbineh.emailInvalid"));
      return;
    }
    setError(null);
    // Open synchronously to avoid popup blockers
    if (typeof window !== "undefined") {
      window.open(CALENDLY_URL, "_blank", "noopener");
    }
    try {
      void supabase.functions
        .invoke("notify-lead", { body: { type: "turbineh_lead", email: mail, lang } })
        .catch(() => {});
    } catch {
      /* ignore */
    }
    setDone(true);
  };

  return (
    <section className="relative overflow-hidden bg-[var(--brand-navy)] text-white">
      <div className="pointer-events-none absolute inset-0 cyber-grid opacity-30" />
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[var(--brand-green)]/10 blur-3xl" />
      <div className="relative mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[var(--brand-green-lime)]">
            <img src={logoAsset.url} alt="" width={16} height={16} className="h-4 w-4" />
            {t("turbineh.eyebrow")}
          </div>
          <h2 className="mt-5 text-3xl font-bold tracking-tight md:text-4xl">
            {t("turbineh.title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-[var(--text-muted)] md:text-lg">
            {t("turbineh.lead")}
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {blocks.map((b) => (
            <div
              key={b.t}
              className="reveal rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-[var(--brand-green)]/40"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--brand-green)]/15 text-[var(--brand-green-lime)]">
                <Check className="h-4 w-4" strokeWidth={3} />
              </div>
              <h3 className="text-base font-semibold">{b.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{b.d}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 md:grid-cols-[1.3fr_1fr] md:p-10">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--brand-green-lime)]">
              <Sparkles className="h-3.5 w-3.5" /> {t("turbineh.labTitle")}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
              {t("turbineh.labBody")}
            </p>
            <p className="mt-5 text-lg font-semibold text-white">{t("turbineh.closing")}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[var(--brand-navy-2)] p-6">
            <h3 className="text-lg font-semibold">{t("turbineh.formTitle")}</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{t("turbineh.formBody")}</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("turbineh.emailPlaceholder") as string}
              className="mt-4 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--brand-green)]"
            />
            <button
              onClick={handleBook}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-green)] px-5 py-3.5 text-sm font-semibold text-[var(--brand-navy)] transition hover:brightness-110"
            >
              {t("turbineh.cta")} <ArrowRight className="h-4 w-4" />
            </button>
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {error}
              </p>
            )}
            {done && !error && (
              <p className="mt-2 text-sm text-[var(--brand-green-lime)]">{t("turbineh.success")}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- FOOTER ---------------- */
function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 md:flex-row md:px-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-brand to-brand-2 text-white">
              <Shield className="h-3.5 w-3.5" strokeWidth={2.5} />
            </div>
            <span className="text-sm font-semibold">TurbineH Security</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("footer.tagline")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            © {new Date().getFullYear()} TurbineH Security. {t("footer.rights")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <a href="/legal/terms" className="hover:text-foreground">{t("legal.terms")}</a>
          <a href="/legal/privacy" className="hover:text-foreground">{t("legal.privacy")}</a>
          
          <a href="mailto:hello@turbineh.com" className="hover:text-foreground">
            {t("legal.contact")}
          </a>
          <LangToggle />
        </div>
      </div>
    </footer>
  );
}

// keep effect-only import for stable render on mount
export function _noop() {
  useEffect(() => {}, []);
}
