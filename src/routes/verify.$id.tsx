import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Loader2, CheckCircle2, ShieldCheck, MailCheck, AlertCircle } from "lucide-react";

const RESEND_COOLDOWN_S = 60;
const LOCAL_PART_RE = /^[a-zA-Z0-9._%+-]+$/;
const QUICK_PICKS = ["admin", "webmaster", "info", "contact"] as const;

type ScanState = {
  id: string;
  normalized_domain: string;
  status: string;
  verification_status: string | null;
  lang: string | null;
  report_consumed: boolean;
};

function Placeholder({ title, body }: { title: string; body: string }) {
  const { i18n } = useTranslation();
  const back = i18n.language?.startsWith("en") ? "Back to home" : "Volver al inicio";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-24 text-center md:px-6">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-4 text-muted-foreground">{body}</p>
        <Link
          to="/"
          className="mt-8 inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
        >
          {back}
        </Link>
      </div>
    </div>
  );
}

export { Placeholder };

export const Route = createFileRoute("/verify/$id")({
  component: VerifyPage,
});

function VerifyPage() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [loadError, setLoadError] = useState(false);

  const loadScan = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase.functions.invoke("get-scan", {
        body: { scanRequestId: id },
      });
      if (error || !data || (data as { error?: string }).error) {
        setScan(null);
        setLoadError(true);
      } else {
        setScan(data as ScanState);
      }
    } catch {
      setScan(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadScan();
  }, [loadScan]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex max-w-2xl items-center justify-center gap-3 px-4 py-32 text-muted-foreground md:px-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t("verify.loading")}</span>
        </div>
      </div>
    );
  }

  if (loadError || !scan) {
    return (
      <Placeholder
        title={t("verify.notFoundTitle")}
        body={t("verify.notFoundBody")}
      />
    );
  }

  const isVerified = scan.status === "verified";
  const isVerifiable =
    scan.status === "paid_pending_verification" ||
    scan.status === "verification_failed";

  if (isVerified) {
    return (
      <SuccessView
        scanId={scan.id}
        lang={lang}
        navigate={navigate}
      />
    );
  }

  if (!isVerifiable) {
    return (
      <Placeholder
        title={t("verify.notFoundTitle")}
        body={t("verify.notFoundBody")}
      />
    );
  }

  return (
    <VerificationView
      scan={scan}
      onVerified={() => loadScan()}
    />
  );
}

function SuccessView({
  scanId,
  lang,
  navigate,
}: {
  scanId: string;
  lang: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { t } = useTranslation();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleRun() {
    setStarting(true);
    setStartError(null);
    try {
      const { data, error } = await supabase.functions.invoke("start-diagnostic", {
        body: { scanRequestId: scanId },
      });
      const payload = data as { status?: string; error?: string } | null;
      if (error || !payload || payload.error) {
        setStartError(t("processing.startFailed"));
        setStarting(false);
        return;
      }
      navigate({
        to: "/processing/$id",
        params: { id: scanId },
        search: { lang } as never,
      });
    } catch {
      setStartError(t("processing.startFailed"));
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-20 md:px-6">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {t("verify.successTitle")}
            </h1>
          </div>
          <p className="mt-4 text-muted-foreground">{t("verify.successBody")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" onClick={handleRun} disabled={starting} className="gap-2">
              {starting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t("processing.starting")}
                </>
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5" />
                  {t("verify.runCta")}
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">{scanId.slice(0, 8)}</span>
          </div>
          {startError && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{startError}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VerificationView({
  scan,
  onVerified,
}: {
  scan: ScanState;
  onVerified: () => void;
}) {
  const { t } = useTranslation();
  const domain = scan.normalized_domain;

  const [localPart, setLocalPart] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);

  const [cooldown, setCooldown] = useState(0);
  const lastSubmittedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const email = useMemo(
    () => `${localPart.trim().toLowerCase()}@${domain}`,
    [localPart, domain],
  );

  const canSend = cooldown === 0 && !sending;

  async function handleSend(overrideLocal?: string) {
    setSendError(null);
    setVerifyError(null);
    const lp = (overrideLocal ?? localPart).trim().toLowerCase();
    if (!lp) {
      setSendError(t("verify.errors.localEmpty"));
      return;
    }
    if (!LOCAL_PART_RE.test(lp)) {
      setSendError(t("verify.errors.localInvalid"));
      return;
    }
    const fullEmail = `${lp}@${domain}`;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-verification-code",
        { body: { scanRequestId: scan.id, email: fullEmail } },
      );
      if (error || !data) {
        setSendError(t("verify.errors.sendFailed"));
        return;
      }
      const payload = data as {
        sent?: boolean;
        alreadyVerified?: boolean;
        maskedEmail?: string;
        reason?: string;
        error?: string;
      };
      if (payload.alreadyVerified) {
        onVerified();
        return;
      }
      if (payload.reason === "domain_mismatch") {
        setSendError(t("verify.errors.domainMismatch"));
        return;
      }
      if (payload.reason === "cooldown") {
        setSendError(t("verify.errors.cooldown"));
        setCooldown(RESEND_COOLDOWN_S);
        return;
      }
      if (payload.reason === "hourly_limit") {
        setSendError(t("verify.errors.hourly"));
        return;
      }
      if (!payload.sent) {
        setSendError(t("verify.errors.sendFailed"));
        return;
      }
      setMaskedEmail(payload.maskedEmail ?? fullEmail);
      setLocalPart(lp);
      setCooldown(RESEND_COOLDOWN_S);
      setCode("");
      setAttemptsLeft(null);
      lastSubmittedCodeRef.current = null;
    } catch {
      setSendError(t("verify.errors.sendFailed"));
    } finally {
      setSending(false);
    }
  }

  const handleVerify = useCallback(
    async (submittedCode: string) => {
      if (!/^\d{6}$/.test(submittedCode)) return;
      if (lastSubmittedCodeRef.current === submittedCode && verifying) return;
      lastSubmittedCodeRef.current = submittedCode;
      setVerifying(true);
      setVerifyError(null);
      try {
        const { data, error } = await supabase.functions.invoke("verify-domain", {
          body: { scanRequestId: scan.id, code: submittedCode },
        });
        if (error || !data) {
          setVerifyError(t("verify.errors.verifyFailed"));
          return;
        }
        const payload = data as {
          verified?: boolean;
          reason?: string;
          attemptsLeft?: number;
        };
        if (payload.verified) {
          onVerified();
          return;
        }
        if (payload.reason === "expired") {
          setVerifyError(t("verify.errors.expired"));
        } else if (payload.reason === "too_many_attempts") {
          setVerifyError(t("verify.errors.tooManyAttempts"));
        } else if (payload.reason === "no_code") {
          setVerifyError(t("verify.errors.noCode"));
        } else if (payload.reason === "invalid_code") {
          let msg = t("verify.errors.invalidCode");
          if (typeof payload.attemptsLeft === "number") {
            setAttemptsLeft(payload.attemptsLeft);
            msg += " " + t("verify.errors.attemptsLeft", { n: payload.attemptsLeft });
          }
          setVerifyError(msg);
        } else {
          setVerifyError(t("verify.errors.verifyFailed"));
        }
      } catch {
        setVerifyError(t("verify.errors.verifyFailed"));
      } finally {
        setVerifying(false);
      }
    },
    [scan.id, t, onVerified, verifying],
  );

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (code.length === 6 && !verifying && lastSubmittedCodeRef.current !== code) {
      handleVerify(code);
    }
  }, [code, verifying, handleVerify]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-16 md:px-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {t("verify.title")}
            </h1>
          </div>
          <p className="mt-4 text-muted-foreground">
            {t("verify.intro", { domain })}
          </p>

          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("verify.domainLabel")}
            </div>
            <div className="mt-1 font-mono text-lg font-semibold">{domain}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {t("verify.domainLocked")}
            </div>
          </div>

          {/* STEP 1 */}
          <section className="mt-8">
            <h2 className="text-lg font-semibold">{t("verify.step1Title")}</h2>

            <label className="mt-4 block text-sm font-medium" htmlFor="local-part">
              {t("verify.localPartLabel")}
            </label>
            <div className="mt-2 flex overflow-hidden rounded-md border border-input focus-within:ring-1 focus-within:ring-ring">
              <Input
                id="local-part"
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder={t("verify.localPartPlaceholder")}
                className="flex-1 rounded-none border-0 shadow-none focus-visible:ring-0"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex items-center bg-muted px-3 font-mono text-sm text-muted-foreground">
                @{domain}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs text-muted-foreground">
                {t("verify.quickPickLabel")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_PICKS.map((lp) => (
                  <button
                    key={lp}
                    type="button"
                    onClick={() => {
                      setLocalPart(lp);
                    }}
                    className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs hover:bg-muted"
                  >
                    {lp}@{domain}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              {t("verify.emailHelper")}
            </p>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button
                onClick={() => handleSend()}
                disabled={!canSend}
                className="gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("verify.sending")}
                  </>
                ) : (
                  <>
                    <MailCheck className="h-4 w-4" />
                    {maskedEmail
                      ? cooldown > 0
                        ? t("verify.resendIn", { s: cooldown })
                        : t("verify.resend")
                      : t("verify.sendCode")}
                  </>
                )}
              </Button>
              {maskedEmail && (
                <span className="text-sm text-muted-foreground">
                  {t("verify.sentTo", { email: maskedEmail })}
                </span>
              )}
            </div>

            {sendError && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{sendError}</span>
              </div>
            )}
          </section>

          {/* STEP 2 */}
          {maskedEmail && (
            <section className="mt-10 border-t border-border pt-8">
              <h2 className="text-lg font-semibold">{t("verify.step2Title")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("verify.step2Helper")}
              </p>

              <div className="mt-4 flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    if (v.length < 6) {
                      lastSubmittedCodeRef.current = null;
                    }
                  }}
                  disabled={verifying}
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-12 w-12 text-lg" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <div className="mt-4 flex flex-col items-center gap-2">
                <Button
                  onClick={() => handleVerify(code)}
                  disabled={verifying || code.length !== 6}
                  variant="secondary"
                  className="gap-2"
                >
                  {verifying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("verify.verifying")}
                    </>
                  ) : (
                    t("verify.verifyBtn")
                  )}
                </Button>
                {attemptsLeft !== null && !verifyError && (
                  <span className="text-xs text-muted-foreground">
                    {t("verify.errors.attemptsLeft", { n: attemptsLeft })}
                  </span>
                )}
              </div>

              {verifyError && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
