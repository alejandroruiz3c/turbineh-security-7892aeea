import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

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
  component: function Verify() {
    const { id } = Route.useParams();
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Verify your domain" : "Verifica tu dominio"}
        body={
          (en ? "Verification for " : "Verificación para ") +
          id +
          (en
            ? ". This step will confirm you own the domain before we run the analysis."
            : ". Este paso confirmará que eres propietario del dominio antes de analizarlo.")
        }
      />
    );
  },
});
