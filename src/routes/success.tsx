import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./verify.$id";

export const Route = createFileRoute("/success")({
  component: function Success() {
    const { i18n } = useTranslation();
    const en = i18n.language?.startsWith("en");
    return (
      <Placeholder
        title={en ? "Payment successful" : "Pago completado"}
        body={
          en
            ? "Thanks! We'll email your report shortly."
            : "¡Gracias! Te enviaremos el informe por email en breve."
        }
      />
    );
  },
});
