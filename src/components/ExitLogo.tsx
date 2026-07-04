import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import logoAsset from "@/assets/turbineh-mark.png.asset.json";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type Variant = "default" | "report";

export function ExitLogo({
  variant = "default",
  className,
  imgClassName,
}: {
  variant?: Variant;
  className?: string;
  imgClassName?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const prefix = variant === "report" ? "exitLogo.report" : "exitLogo.default";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("exitLogo.aria")}
        className={cn(
          "inline-flex items-center gap-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <img
          src={logoAsset.url}
          alt="TurbineH Security"
          className={cn("h-9 w-auto", imgClassName)}
        />
      </button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${prefix}.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${prefix}.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("exitLogo.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOpen(false);
                navigate({ to: "/" });
              }}
            >
              {t("exitLogo.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
