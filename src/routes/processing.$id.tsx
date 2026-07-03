import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./verify.$id";

export const Route = createFileRoute("/processing/$id")({
  component: function Processing() {
    const { id } = Route.useParams();
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Running your diagnosis…" : "Ejecutando tu diagnóstico…"}
        body={
          (en ? "Analyzing " : "Analizando ") +
          id +
          (en ? ". This usually takes a few minutes." : ". Suele tardar unos minutos.")
        }
      />
    );
  },
});
