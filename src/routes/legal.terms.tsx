import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./verify.$id";

export const Route = createFileRoute("/legal/terms")({
  component: function Terms() {
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Terms of Service" : "Términos del servicio"}
        body={en ? "Coming soon." : "Próximamente."}
      />
    );
  },
});
