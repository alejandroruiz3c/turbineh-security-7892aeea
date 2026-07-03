import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Cookies from "js-cookie";
import { resources, type Lang } from "./dictionary";

const COOKIE = "turbineh_lang";

function detectInitial(): Lang {
  if (typeof window === "undefined") return "es";
  const qs = new URLSearchParams(window.location.search).get("lang");
  if (qs === "en" || qs === "es") return qs;
  const cookie = Cookies.get(COOKIE);
  if (cookie === "en" || cookie === "es") return cookie;
  const nav = (navigator.language || "es").toLowerCase();
  return nav.startsWith("en") ? "en" : "es";
}

let initialized = false;
export function initI18n() {
  if (initialized) return i18n;
  initialized = true;
  i18n.use(initReactI18next).init({
    resources,
    lng: detectInitial(),
    fallbackLng: "es",
    supportedLngs: ["es", "en"],
    interpolation: { escapeValue: false },
    returnObjects: true,
  });
  return i18n;
}

export function setLang(lang: Lang) {
  i18n.changeLanguage(lang);
  Cookies.set(COOKIE, lang, { expires: 365, sameSite: "lax" });
  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", lang);
    window.history.replaceState({}, "", url.toString());
    document.documentElement.lang = lang;
  }
}

export function currentLang(): Lang {
  return (i18n.language?.startsWith("en") ? "en" : "es") as Lang;
}

export default i18n;
