import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ShieldCheck } from "lucide-react";

type ScanState = {
  id: string;
  normalized_domain: string;
  status: string;
  verification_status: string | null;
  lang: string | null;
  report_consumed: boolean;
};

const POLL_MS = 3000;
const STEP_ROTATE_MS = 2500;

export const Route = createFileRoute("/processing/$id")({
  component: ProcessingPage,
});

function ProcessingPage() {
  const { id } = Route.useParams();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const navigate = useNavigate();

  const [scan, setScan] = useState<ScanState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const startedRef = useRef(false);
  const startedAtRef = useRef<number>(Date.now());

  const steps = (t("processing.steps", { returnObjects: true }) as string[]) ?? [];

  const fetchScan = useCallback(async (): Promise<ScanState | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("get-scan", {
        body: { scanRequestId: id },
      });
      if (error || !data || (data as { error?: string }).error) {
        setNotFound(true);
        return null;
      }
      const s = data as ScanState;
      setScan(s);
      return s;
    } catch {
      setNotFound(true);
      return null;
    }
  }, [id]);

  const startIfNeeded = useCallback(async (current: ScanState) => {
    if (startedRef.current) return;
    if (current.status === "processing" || current.status === "completed") {
      startedRef.current = true;
      return;
    }
    startedRef.current = true;
    setStartError(null);
    try {
      const { data, error } = await supabase.functions.invoke("start-diagnostic", {
        body: { scanRequestId: id },
      });
      const payload = data as { status?: string; error?: string } | null;
      if (error || !payload || payload.error) {
        setStartError(t("processing.startFailed"));
        startedRef.current = false;
      }
    } catch {
      setStartError(t("processing.startFailed"));
      startedRef.current = false;
    }
  }, [id, t]);

  // Initial load
  useEffect(() => {
    (async () => {
      const s = await fetchScan();
      if (s) await startIfNeeded(s);
    })();
  }, [fetchScan, startIfNeeded]);

  // Poll
  useEffect(() => {
    if (!scan) return;
    if (scan.status === "completed") {
      navigate({
        to: "/report/$id",
        params: { id: scan.id },
        search: { lang } as never,
      });
      return;
    }
    if (scan.status === "failed") return;
    const t = setTimeout(() => {
      fetchScan();
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [scan, fetchScan, navigate, lang]);

  // Elapsed timer + step rotation
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (steps.length === 0) return;
    const iv = setInterval(() => {
      setStepIdx((i) => (i + 1) % steps.length);
    }, STEP_ROTATE_MS);
    return () => clearInterval(iv);
  }, [steps.length]);

  if (notFound) {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold">{t("verify.notFoundTitle")}</h1>
          <p className="mt-3 text-muted-foreground">{t("verify.notFoundBody")}</p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            {t("verify.backHome")}
          </Link>
        </div>
      </Shell>
    );
  }

  if (scan?.status === "failed") {
    return (
      <Shell>
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <h1 className="text-2xl font-bold">{t("processing.failedTitle")}</h1>
          </div>
          <p className="mt-3 text-muted-foreground">{t("processing.failedBody")}</p>
          <a
            href="mailto:hola@turbineh.com"
            className="mt-6 inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            {t("processing.contactSupport")}
          </a>
        </div>
      </Shell>
    );
  }

  const domain = scan?.normalized_domain ?? "";
  const currentStep = steps[stepIdx] ?? t("processing.starting");

  return (
    <Shell>
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {t("processing.title")}
          </h1>
        </div>
        <p className="mt-4 text-muted-foreground">
          {t("processing.subtitle", { domain })}
        </p>

        <div className="mt-8 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
          <span className="text-sm font-medium">{currentStep}</span>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("processing.elapsed", { s: elapsed })}</span>
          <span>{t("processing.reassure")}</span>
        </div>

        {startError && (
          <div className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{startError}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const s = await fetchScan();
                if (s) await startIfNeeded(s);
              }}
            >
              {t("processing.retry")}
            </Button>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-20 md:px-6">{children}</div>
    </div>
  );
}
