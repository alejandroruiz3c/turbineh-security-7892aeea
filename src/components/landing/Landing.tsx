import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LangToggle } from "@/components/LangToggle";
import { normalizeDomain, validateDomain } from "@/lib/domain";
import { startCheckout } from "@/lib/checkout";
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

  const [rawDomain, setRawDomain] = useState("");
  const [normalized, setNormalized] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [email, setEmail] = useState("");

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
    setTimeout(() => scrollToId("preview"), 60);
  };

  const handleCheckout = () => {
    if (!normalized) {
      scrollToId("domain-input");
      return;
    }
    startCheckout(normalized, email || undefined, lang);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
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
          <PreviewSection domain={normalized} cardKeys={previewCards} onCta={handleCheckout} />
        )}
        <Paywall
          email={email}
          setEmail={setEmail}
          onCheckout={handleCheckout}
        />
        <AiSection domain={normalized ?? (lang === "en" ? "yourdomain.com" : "midominio.com")} />
        <WhatIsExposure />
        <WhatWeCheck />
        <DiagnosisVsPentest />
        <WhoItsFor />
        <FAQ />
        <LegalDisclaimer />
      </main>
      <Footer />
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
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-white shadow-sm">
            <Shield className="h-4 w-4" strokeWidth={2.5} />
          </div>
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
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-40 right-0 h-[300px] w-[300px] rounded-full bg-brand-2/10 blur-3xl" />
      </div>
      <div className="mx-auto max-w-6xl px-4 pt-14 pb-20 md:px-6 md:pt-24 md:pb-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            TurbineH Security · Web Exposure Diagnosis
          </span>
          <h1 className="mt-6 text-4xl font-bold leading-[1.1] tracking-tight md:text-6xl">
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
function PreviewSection({
  domain,
  cardKeys,
  onCta,
}: {
  domain: string;
  cardKeys: readonly (typeof CARD_KEYS)[number][];
  onCta: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section id="preview" className="scroll-mt-24 border-t border-border/60">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t("preview.headingFor")}{" "}
            <span className="text-brand">{domain}</span>
          </h2>
        </div>
        <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm text-foreground/80">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 shrink-0 text-brand" />
            <p>{t("preview.disclaimer")}</p>
          </div>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cardKeys.map((k) => {
            const Icon = CARD_ICONS[k];
            return (
              <div
                key={k}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold leading-snug">
                  {t(`preview.cards.${k}.t`)}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(`preview.cards.${k}.d`)}
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                  {t("preview.tag")}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mx-auto mt-10 max-w-3xl text-center text-sm text-muted-foreground">
          {t("preview.closing")}
        </p>
        <div className="mt-8 text-center">
          <button
            onClick={onCta}
            className="inline-flex items-center gap-2 rounded-xl bg-cta px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-md shadow-cta/20 hover:brightness-110 transition"
          >
            {t("paywall.button")} <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------------- PAYWALL ---------------- */
function Paywall({
  hasDomain,
  email,
  setEmail,
  onCheckout,
}: {
  hasDomain: boolean;
  email: string;
  setEmail: (v: string) => void;
  onCheckout: () => void;
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
                {t("nav.pricing")}
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
                <span className="text-5xl font-bold tracking-tight">€99</span>
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
                  className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-5 py-3.5 text-sm font-semibold text-cta-foreground shadow-md shadow-cta/20 hover:brightness-110 transition"
                >
                  {t("paywall.button")} <ArrowRight className="h-4 w-4" />
                </button>
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
          <a href="/legal/refunds" className="hover:text-foreground">{t("legal.refunds")}</a>
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
