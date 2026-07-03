import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./verify.$id";

export const Route = createFileRoute("/cancel")({
  component: function Cancel() {
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Payment cancelled" : "Pago cancelado"}
        body={en ? "No charge was made." : "No se ha realizado ningún cargo."}
      />
    );
  },
});
