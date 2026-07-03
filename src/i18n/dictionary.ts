// All visible strings. Keep bilingual parity: every ES key must have an EN sibling.
export const resources = {
  es: {
    translation: {
      meta: {
        title: "Diagnóstico de Exposición Web — TurbineH Security",
        description:
          "Descubre qué expone tu web y cierra los riesgos con IA. Diagnóstico claro, pago único de 99 €.",
      },
      nav: {
        how: "Cómo funciona",
        what: "Qué revisamos",
        pricing: "Precio",
        faq: "FAQ",
        cta: "Analizar mi web",
      },
      hero: {
        title: "Evita el secuestro de tu negocio pagando 100 veces menos.",
        subtitle:
          "1 de cada 3 negocios online sufren suplantación de marca, caídas a propósito o filtraciones. Esto puede costarte miles al día. Con IA puedes identificar y resolver riesgos tú mismo.",
        trust: "",
        reassure: {
          minutes: "Análisis en minutos",
          once: "Plan de acción claro",
          notech: "Sin conocimientos técnicos necesarios",
        },
      },
      domainInput: {
        placeholder: "midominio.com",
        button: "Analiza mi dominio gratis",
        errors: {
          empty: "Introduce un dominio para continuar.",
          invalid: "Ese no parece un dominio válido. Ej: midominio.com",
          localhost: "No podemos analizar localhost ni direcciones IP.",
          ip: "Introduce un nombre de dominio, no una IP.",
        },
      },
      how: {
        title: "Cómo funciona",
        s1: "Introduce tu dominio",
        s2: "Recibe tu diagnóstico preliminar",
        s3: "Descarga el análisis profundo y tu plan de acción",
        s4: "Ejecútalo tú mismo siguiendo las instrucciones en tu IA favorita",
      },
      preview: {
        headingFor: "Informe preliminar para",
        reportId: "ID de informe",
        scannedAt: "Escaneado",
        findings: "hallazgos potenciales",
        summary: "Resumen de exposición",
        priority: "Prioridad",
        risk: "Riesgo",
        impact: "Impacto",
        status: "Pendiente de verificar en tu diagnóstico completo",
        severity: { critical: "Crítico", high: "Alto", medium: "Medio", low: "Bajo" },
        disclaimer:
          "Preview gratuito basado en vulnerabilidades potenciales y riesgos comunes que revisaremos en tu dominio. Para ejecutar el análisis completo y ver tus hallazgos concretos, desbloquea el diagnóstico.",
        tag: "Se revisará en tu diagnóstico",
        closing:
          "Estos son riesgos habituales en dominios como el tuyo. En el diagnóstico completo analizamos tu web real, ampliamos los hallazgos y los convertimos en un plan de acción priorizado para que puedas resolverlos paso a paso, incluso con un asistente de IA como Claude, Fable u otra herramienta equivalente.",
        cards: {
          headers: {
            t: "Headers de seguridad ausentes o incompletos",
            d: "Sin los headers correctos, el navegador tiene menos defensas para bloquear scripts maliciosos, clickjacking o recursos no controlados.",
          },
          dmarc: {
            t: "DMARC débil o no configurado",
            d: "Cualquiera podría enviar emails haciéndose pasar por tu empresa: phishing a tus clientes, fraude y daño a tu reputación.",
          },
          cookies: {
            t: "Cookies sin configuración segura",
            d: "Cookies mal configuradas pueden exponer sesiones o datos de navegación si faltan atributos como Secure, HttpOnly o SameSite.",
          },
          ssl: {
            t: "SSL/TLS mal configurado",
            d: "Tener el candado no basta. Una configuración débil reduce la confianza del navegador y puede exponer problemas de cifrado.",
          },
          tech: {
            t: "Tecnologías visibles públicamente",
            d: "Si tu web revela su CMS, plugins o versiones, le sirves en bandeja a un atacante los fallos conocidos que puede probar.",
          },
          forms: {
            t: "Formularios sin suficientes protecciones",
            d: "Los formularios públicos pueden ser abusados para spam, inyección o automatización maliciosa sin los controles adecuados.",
          },
          csp: {
            t: "Content Security Policy débil o inexistente",
            d: "Sin una CSP sólida, una simple inyección de scripts puede convertirse en un problema grave.",
          },
          admin: {
            t: "Paneles de administración expuestos",
            d: "Un panel de acceso visible al público invita a intentos de acceso no autorizado si no está bien protegido.",
          },
          dns: {
            t: "Higiene DNS/email insuficiente",
            d: "Una configuración DNS o de correo incompleta facilita la suplantación y resta confianza a tus comunicaciones.",
          },
        },
      },
      paywall: {
        title: "Desbloquea tu diagnóstico completo — 99 €",
        value:
          "Pago único. Sin suscripciones, sin consultores. Menos de lo que cuesta una hora de un experto en seguridad.",
        includes: "Incluye",
        bullets: [
          "Análisis real de tu dominio",
          "Hallazgos priorizados por impacto",
          "Explicación clara de cada riesgo",
          "Acciones recomendadas",
          "Prompts de IA listos para cada punto",
          "Cuándo pedir ayuda técnica",
          "Checklist final",
          "Informe descargable en PDF",
        ],
        emailLabel: "Tu email para recibir el informe",
        emailPlaceholder: "tu@empresa.com",
        button: "Ejecutar análisis y plan de acción completo",
        buttonLoading: "Procesando…",
        error: "No hemos podido iniciar tu diagnóstico. Inténtalo de nuevo en unos segundos.",
        secure: "Pago seguro. Sin suscripción.",
      },
      ai: {
        title: "Lo que antes costaba miles al mes, ahora lo hace la IA.",
        body: "Hasta hoy, saber si tu web era segura significaba pagar consultores caros mes tras mes. La IA acaba de cambiar las reglas. Aquí la ponemos a trabajar para ti: detecta tus riesgos, te explica por qué importan y te entrega los pasos exactos —y los prompts listos para copiar— para resolverlos tú mismo.",
        promptLabel: "Ejemplo de prompt incluido en tu informe",
        prompt:
          "Actúa como un consultor senior de seguridad web. Mi dominio es {dominio}. He recibido este hallazgo: 'Falta el header Content-Security-Policy'. Explícame en lenguaje claro por qué es un riesgo, dame los pasos exactos para corregirlo en mi servidor y una CSP inicial segura para un sitio con formularios y analítica.",
      },
      what: {
        exposureTitle: "¿Qué es la exposición web?",
        exposureBody:
          "La exposición web es todo lo que tu página muestra públicamente al exterior: configuración, cabeceras de seguridad, certificado SSL, DNS, correo corporativo, cookies, tecnologías visibles y señales que pueden facilitar ataques, suplantación o pérdida de confianza.",
        checkTitle: "Qué revisamos",
        items: [
          "HTTPS y redirecciones",
          "Certificado SSL/TLS",
          "Headers de seguridad (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)",
          "Cookies",
          "DNS",
          "Seguridad email (SPF/DKIM/DMARC)",
          "Tecnologías visibles y CMS",
          "robots.txt y sitemap",
          "Formularios públicos",
          "Paneles expuestos habituales",
        ],
      },
      vs: {
        title: "Diagnóstico ≠ Pentest",
        body: "Esto es un diagnóstico externo automatizado, defensivo e informativo. No es un pentest, no explotamos vulnerabilidades, no accedemos a sistemas privados y no es una garantía de seguridad.",
        col1t: "Diagnóstico (esto)",
        col1: [
          "Automatizado y externo",
          "Señales públicas de configuración",
          "Informativo y defensivo",
          "Listo en minutos, 99 €",
        ],
        col2t: "Pentest completo",
        col2: [
          "Manual, con expertos",
          "Explotación de vulnerabilidades",
          "Acceso autorizado a sistemas",
          "Semanas de trabajo, miles de €",
        ],
      },
      who: {
        title: "Para quién es",
        items: [
          "Founders",
          "Pymes",
          "Agencias",
          "Ecommerces",
          "Negocios locales",
          "Consultoras",
          "SaaS",
        ],
      },
      faq: {
        title: "Preguntas frecuentes",
        items: [
          {
            q: "¿Esto es un pentest?",
            a: "No. Es un diagnóstico externo automatizado que analiza señales públicas de tu web. Un pentest es un trabajo manual, más profundo y mucho más caro.",
          },
          {
            q: "¿Analizáis mi dominio de verdad?",
            a: "Sí. Tras el pago ejecutamos el análisis real sobre tu dominio y generamos un informe con hallazgos concretos.",
          },
          {
            q: "¿Puedo arreglarlo yo mismo?",
            a: "En la mayoría de casos sí. El informe incluye pasos claros y prompts de IA listos para copiar. Indicamos también cuándo conviene pedir ayuda técnica.",
          },
          {
            q: "¿Necesito un desarrollador?",
            a: "Para muchos ajustes no. Para otros (por ejemplo, tocar servidor) recomendamos apoyarte en alguien técnico o en tu proveedor de hosting.",
          },
          {
            q: "¿Qué incluye el PDF?",
            a: "Resumen ejecutivo, hallazgos priorizados, explicación de cada riesgo, acciones recomendadas, prompts de IA y checklist final.",
          },
          {
            q: "¿Funciona con WordPress, Webflow, Shopify o desarrollo a medida?",
            a: "Sí. Analizamos señales públicas del dominio, independientemente de la tecnología.",
          },
          {
            q: "¿Y si no encontráis riesgos serios?",
            a: "Mejor noticia imposible. Recibirás igualmente el informe con recomendaciones de hardening y buenas prácticas.",
          },
          {
            q: "¿Por qué tengo que verificar el dominio?",
            a: "Para confirmar que eres propietario o tienes autorización. Es un paso rápido y protege a todos.",
          },
        ],
      },
      legal: {
        disclaimer:
          "El informe tiene finalidad defensiva e informativa. El cliente declara que es propietario del dominio analizado o que cuenta con autorización para solicitar el diagnóstico.",
        terms: "Términos",
        privacy: "Privacidad",
        refunds: "Reembolsos",
        contact: "Contacto",
      },
      footer: {
        tagline: "Diagnóstico de exposición web con IA.",
        rights: "Todos los derechos reservados.",
      },
    },
  },
  en: {
    translation: {
      meta: {
        title: "Web Exposure Diagnosis — TurbineH Security",
        description:
          "Find out what your website exposes and close the risks with AI. Clear diagnosis, one-time €99.",
      },
      nav: {
        how: "How it works",
        what: "What we check",
        pricing: "Pricing",
        faq: "FAQ",
        cta: "Analyze my site",
      },
      hero: {
        title: "Avoid your business being hijacked — for 100× less.",
        subtitle:
          "1 in 3 online businesses suffer brand impersonation, deliberate downtime or data leaks. This can cost you thousands a day. With AI you can identify and fix the risks yourself.",
        trust: "",
        reassure: {
          minutes: "Analysis in minutes",
          once: "Clear action plan",
          notech: "No tech skills required",
        },
      },
      domainInput: {
        placeholder: "yourdomain.com",
        button: "Analyze my domain free",
        errors: {
          empty: "Enter a domain to continue.",
          invalid: "That doesn't look like a valid domain. Ex: yourdomain.com",
          localhost: "We can't analyze localhost or IP addresses.",
          ip: "Enter a domain name, not an IP.",
        },
      },
      how: {
        title: "How it works",
        s1: "Enter your domain",
        s2: "Get your preliminary diagnosis",
        s3: "Download the deep analysis and your action plan",
        s4: "Execute it yourself with your favorite AI assistant",
      },
      preview: {
        headingFor: "Preliminary report for",
        reportId: "Report ID",
        scannedAt: "Scanned",
        findings: "potential findings",
        summary: "Exposure summary",
        priority: "Priority",
        risk: "Risk",
        impact: "Impact",
        status: "Pending verification in your full diagnosis",
        severity: { critical: "Critical", high: "High", medium: "Medium", low: "Low" },
        disclaimer:
          "Free preview based on potential vulnerabilities and common risks we'll check on your domain. To run the full analysis and see your concrete findings, unlock the diagnosis.",
        tag: "Checked in your diagnosis",
        closing:
          "These are common risks for domains like yours. In the full diagnosis we analyze your real website, expand the findings and turn them into a prioritized action plan so you can fix them step by step, even with an AI assistant like Claude, Fable or an equivalent tool.",
        cards: {
          headers: {
            t: "Missing or incomplete security headers",
            d: "Without the right headers, the browser has fewer defenses to block malicious scripts, clickjacking or uncontrolled resources.",
          },
          dmarc: {
            t: "Weak or missing DMARC",
            d: "Anyone could send emails impersonating your company: phishing your customers, fraud and reputation damage.",
          },
          cookies: {
            t: "Insecurely configured cookies",
            d: "Poorly configured cookies can expose sessions or browsing data when attributes like Secure, HttpOnly or SameSite are missing.",
          },
          ssl: {
            t: "Misconfigured SSL/TLS",
            d: "The padlock isn't enough. A weak configuration reduces browser trust and can expose encryption issues.",
          },
          tech: {
            t: "Publicly visible technologies",
            d: "If your site reveals its CMS, plugins or versions, you hand an attacker the known flaws they can try.",
          },
          forms: {
            t: "Forms without enough protections",
            d: "Public forms can be abused for spam, injection or malicious automation without proper controls.",
          },
          csp: {
            t: "Weak or missing Content Security Policy",
            d: "Without a solid CSP, a simple script injection can turn into a serious problem.",
          },
          admin: {
            t: "Exposed admin panels",
            d: "A publicly visible login panel invites unauthorized access attempts if not well protected.",
          },
          dns: {
            t: "Insufficient DNS/email hygiene",
            d: "Incomplete DNS or email configuration enables spoofing and undermines trust in your communications.",
          },
        },
      },
      paywall: {
        title: "Unlock your full diagnosis — €99",
        value:
          "One-time payment. No subscriptions, no consultants. Less than one hour of a security expert.",
        includes: "Included",
        bullets: [
          "Real analysis of your domain",
          "Findings prioritized by impact",
          "Clear explanation of each risk",
          "Recommended actions",
          "Ready-made AI prompts for each item",
          "When to get technical help",
          "Final checklist",
          "Downloadable PDF report",
        ],
        emailLabel: "Your email to receive the report",
        emailPlaceholder: "you@company.com",
        button: "Run full analysis and action plan",
        buttonLoading: "Processing…",
        error: "We couldn't start your diagnosis. Please try again in a few seconds.",
        secure: "Secure payment. No subscription.",
      },
      ai: {
        title: "What used to cost thousands a month, AI now does.",
        body: "Until today, knowing if your site was secure meant paying expensive consultants month after month. AI just changed the rules. We put it to work for you: it detects your risks, explains why they matter, and hands you the exact steps — and ready-to-copy prompts — to fix them yourself.",
        promptLabel: "Example prompt included in your report",
        prompt:
          "Act as a senior web security consultant. My domain is {domain}. I received this finding: 'Missing Content-Security-Policy header'. Explain in plain language why it's a risk, give me exact steps to fix it on my server, and a safe starter CSP for a site with forms and analytics.",
      },
      what: {
        exposureTitle: "What is web exposure?",
        exposureBody:
          "Web exposure is everything your site publicly reveals to the outside: configuration, security headers, SSL certificate, DNS, corporate email, cookies, visible technologies and signals that can enable attacks, impersonation or loss of trust.",
        checkTitle: "What we check",
        items: [
          "HTTPS & redirects",
          "SSL/TLS certificate",
          "Security headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)",
          "Cookies",
          "DNS",
          "Email security (SPF/DKIM/DMARC)",
          "Visible technologies & CMS",
          "robots.txt & sitemap",
          "Public forms",
          "Commonly exposed panels",
        ],
      },
      vs: {
        title: "Diagnosis ≠ Pentest",
        body: "This is an automated external diagnosis — defensive and informational. It is not a pentest, we do not exploit vulnerabilities, we do not access private systems, and it is not a security guarantee.",
        col1t: "Diagnosis (this)",
        col1: [
          "Automated and external",
          "Public configuration signals",
          "Informational and defensive",
          "Ready in minutes, €99",
        ],
        col2t: "Full pentest",
        col2: [
          "Manual, with experts",
          "Vulnerability exploitation",
          "Authorized access to systems",
          "Weeks of work, thousands of €",
        ],
      },
      who: {
        title: "Who it's for",
        items: [
          "Founders",
          "SMBs",
          "Agencies",
          "Ecommerces",
          "Local businesses",
          "Consultancies",
          "SaaS",
        ],
      },
      faq: {
        title: "Frequently asked questions",
        items: [
          {
            q: "Is this a pentest?",
            a: "No. It's an automated external diagnosis that analyzes public signals of your site. A pentest is manual, much deeper and much more expensive.",
          },
          {
            q: "Do you really analyze my domain?",
            a: "Yes. After payment we run the real analysis on your domain and generate a report with concrete findings.",
          },
          {
            q: "Can I fix it myself?",
            a: "In most cases, yes. The report includes clear steps and ready-to-copy AI prompts. We also flag when you should bring in technical help.",
          },
          {
            q: "Do I need a developer?",
            a: "For many tweaks, no. For others (like server-level changes) we recommend leaning on someone technical or your hosting provider.",
          },
          {
            q: "What's in the PDF?",
            a: "Executive summary, prioritized findings, plain-language explanation of each risk, recommended actions, AI prompts and a final checklist.",
          },
          {
            q: "Does it work for WordPress, Webflow, Shopify or custom?",
            a: "Yes. We analyze public signals of the domain, regardless of the underlying tech.",
          },
          {
            q: "What if no serious risks are found?",
            a: "Best news possible. You still receive the report with hardening recommendations and best practices.",
          },
          {
            q: "Why do I have to verify the domain?",
            a: "To confirm you own it or are authorized. It's a quick step and protects everyone.",
          },
        ],
      },
      legal: {
        disclaimer:
          "The report is defensive and informational. The customer declares they own the analyzed domain or are authorized to request the diagnosis.",
        terms: "Terms",
        privacy: "Privacy",
        refunds: "Refunds",
        contact: "Contact",
      },
      footer: {
        tagline: "AI-powered web exposure diagnosis.",
        rights: "All rights reserved.",
      },
    },
  },
} as const;

export type Lang = "es" | "en";
