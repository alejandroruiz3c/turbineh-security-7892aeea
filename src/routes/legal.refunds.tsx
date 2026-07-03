import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "../verify.$id";

export const Route = createFileRoute("/legal/refunds")({
  component: function Refunds() {
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Refund Policy" : "Política de reembolsos"}
        body={en ? "Coming soon." : "Próximamente."}
      />
    );
  },
});
