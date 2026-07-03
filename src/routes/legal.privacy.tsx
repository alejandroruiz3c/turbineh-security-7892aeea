import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./verify.$id";

export const Route = createFileRoute("/legal/privacy")({
  component: function Privacy() {
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Privacy Policy" : "Política de privacidad"}
        body={en ? "Coming soon." : "Próximamente."}
      />
    );
  },
});
