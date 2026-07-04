import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { initI18n } from "../i18n";
import { useTranslation } from "react-i18next";

initI18n();

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0b1220" },
      // GO-LIVE (Fase 8): revert to "index,follow,max-image-preview:large,max-snippet:-1".
      // Temporary noindex while the site is public in MOCK mode (pre-Stripe).
      { name: "robots", content: "noindex,nofollow" },
      { name: "googlebot", content: "noindex,nofollow" },
      { title: "AI Cybersecurity — TurbineH Security" },
      {
        name: "description",
        content:
          "Evita el secuestro de tu negocio online. Diagnóstico de exposición web con IA en minutos y plan de acción claro. Sin conocimientos técnicos.",
      },
      {
        name: "keywords",
        content:
          "diagnóstico exposición web, ciberseguridad para negocios, seguridad web con IA, suplantación de marca, phishing, DNS, SPF DKIM DMARC, hardening web, TurbineH Security",
      },
      { name: "author", content: "TurbineH Security" },
      { name: "application-name", content: "TurbineH Security" },
      // Geo hints
      { name: "geo.region", content: "ES" },
      { name: "geo.placename", content: "España" },
      // Open Graph
      { property: "og:site_name", content: "TurbineH Security" },
      { property: "og:title", content: "AI Cybersecurity — TurbineH Security" },
      {
        property: "og:description",
        content:
          "Evita el secuestro de tu negocio online. Diagnóstico externo automatizado con IA y plan de acción claro.",
      },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "es_ES" },
      { property: "og:locale:alternate", content: "en_US" },
      // Twitter
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "AI Cybersecurity — TurbineH Security" },
      {
        name: "twitter:description",
        content:
          "Diagnóstico externo automatizado con IA y plan de acción claro. Sin conocimientos técnicos.",
      },
      { name: "description", content: "AI Cybersecurity for online businesses" },
      { property: "og:description", content: "AI Cybersecurity for online businesses" },
      { name: "twitter:description", content: "AI Cybersecurity for online businesses" },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/QQ0MLVRBXDVnwmLWPn2CxxjKdg52/social-images/social-1783079837793-F18AD2F0-EC54-48FD-A1AD-CC76A389519D.webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/QQ0MLVRBXDVnwmLWPn2CxxjKdg52/social-images/social-1783079837793-F18AD2F0-EC54-48FD-A1AD-CC76A389519D.webp" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "canonical", href: "/" },
      { rel: "alternate", hrefLang: "es", href: "/?lang=es" },
      { rel: "alternate", hrefLang: "en", href: "/?lang=en" },
      { rel: "alternate", hrefLang: "x-default", href: "/" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "TurbineH Security",
              url: "/",
              description:
                "Diagnóstico de exposición web con IA. Ciberseguridad accesible para pymes y negocios online.",
              areaServed: ["ES", "EU", "LATAM"],
            },
            {
              "@type": "WebSite",
              name: "TurbineH Security",
              url: "/",
              inLanguage: ["es", "en"],
            },
            {
              "@type": "Service",
              name: "Diagnóstico de Exposición Web",
              provider: { "@type": "Organization", name: "TurbineH Security" },
              areaServed: ["ES", "EU", "LATAM"],
              serviceType: "Cybersecurity assessment",
              description:
                "Análisis externo automatizado con IA de la exposición pública de un dominio, con plan de acción priorizado.",
              offers: {
                "@type": "Offer",
                price: "99",
                priceCurrency: "EUR",
                availability: "https://schema.org/InStock",
              },
            },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  return (
    <html lang={lang}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
