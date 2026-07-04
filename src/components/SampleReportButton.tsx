import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Mail, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";

export const SAMPLE_REPORT_URL =
  "https://drive.google.com/file/d/1CqM0TyY8ZJwcmmRji5uqWFz1hl18GBD8/view?usp=drivesdk";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SampleReportButton({ className = "" }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError(t("sample.emailInvalid") as string);
      return;
    }
    // 1) Open synchronously to bypass popup blockers
    window.open(SAMPLE_REPORT_URL, "_blank", "noopener");
    // 2) Fire-and-forget lead + analytics
    try {
      void supabase.functions
        .invoke("notify-lead", {
          body: { type: "example_report", email: clean, lang },
        })
        .catch(() => {});
    } catch {
      /* ignore */
    }
    trackEvent("sample_report_requested", { lang, meta: { email: clean } });
    setError(null);
    setEmail("");
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-brand/40 bg-background/50 px-5 py-3 text-sm font-semibold text-brand backdrop-blur-sm transition hover:bg-brand/5 hover:border-brand " +
          className
        }
      >
        <FileText className="h-4 w-4" />
        {t("sample.button")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md overflow-hidden border-brand/20 bg-card p-0 shadow-2xl shadow-brand/10 sm:rounded-2xl">
          <div className="h-1.5 w-full bg-gradient-to-r from-brand via-brand-2 to-cta" />
          <div className="p-6 md:p-7">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
                {t("sample.title")}
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-relaxed text-muted-foreground">
                {t("sample.body")}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="mt-5 space-y-3">
              <label
                htmlFor="sample-email"
                className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t("sample.emailLabel")}
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="sample-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder={t("sample.emailPlaceholder") as string}
                  autoFocus
                  className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cta px-5 py-3 text-sm font-semibold text-cta-foreground shadow-md shadow-cta/20 transition hover:brightness-110"
              >
                {t("sample.submit")}
              </button>
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                {t("sample.privacy")}
              </p>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// unused import guard
void X;
