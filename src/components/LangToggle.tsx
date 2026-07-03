import { useTranslation } from "react-i18next";
import { setLang } from "@/i18n";
import type { Lang } from "@/i18n/dictionary";

export function LangToggle({ className = "" }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (i18n.language?.startsWith("en") ? "en" : "es") as Lang;
  const btn = (l: Lang, label: string) => (
    <button
      key={l}
      onClick={() => setLang(l)}
      aria-pressed={current === l}
      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition ${
        current === l
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 ${className}`}
    >
      {btn("es", "ES")}
      {btn("en", "EN")}
    </div>
  );
}
