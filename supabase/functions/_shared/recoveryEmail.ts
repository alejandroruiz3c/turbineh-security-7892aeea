// Deterministic, bilingual, high-conversion recovery email templates (NO AI).
// One clear CTA to resume-checkout for that scan. Subject lines vary across the
// 7 days (escalating value/urgency) so the sequence doesn't look repetitive.

type Lang = "es" | "en";

const SUBJECTS: Record<Lang, ((d: string) => string)[]> = {
  es: [
    (d) => `Tu web ${d} sigue sin revisar`,
    (d) => `${d}: lo que un atacante ve de tu negocio hoy`,
    (_d) => `¿Cuánto te costaría que suplantaran tu marca?`,
    (d) => `Tu diagnóstico de ${d} te está esperando`,
    (_d) => `No dejes tu negocio online expuesto una semana más`,
    (d) => `Último recordatorio: revisa la exposición de ${d}`,
    (d) => `Se cierra tu diagnóstico de ${d}`,
  ],
  en: [
    (d) => `Your site ${d} is still unchecked`,
    (d) => `${d}: what an attacker sees about your business today`,
    (_d) => `What would brand impersonation cost you?`,
    (d) => `Your ${d} diagnosis is waiting`,
    (_d) => `Don't leave your online business exposed another week`,
    (d) => `Last reminder: check ${d}'s exposure`,
    (d) => `Your ${d} diagnosis is closing`,
  ],
};

const CTA: Record<Lang, string> = {
  es: "Completar mi diagnóstico",
  en: "Complete my diagnosis",
};

export interface RecoveryEmail {
  subject: string;
  html: string;
  text: string;
}

/** day is 1..7 (defaults clamp into range). */
export function buildRecoveryEmail(
  day: number,
  domain: string,
  lang: Lang,
  resumeUrl: string,
): RecoveryEmail {
  const i = Math.min(6, Math.max(0, day - 1));
  const subject = SUBJECTS[lang][i](domain);

  if (lang === "en") {
    const p1 =
      `You started the analysis of <strong>${domain}</strong> but didn't finish it. ` +
      `Meanwhile your site stays exposed — emails that impersonate your brand, missing ` +
      `security headers, admin paths left reachable — the kind of thing an attacker can ` +
      `use and your customers could end up paying for.`;
    const p2 =
      `Winning back a customer's trust after fraud in your name costs far more than ` +
      `checking your site today.`;
    const p3 =
      `For 99€ you get a clear, jargon-free report: your score, prioritized findings, and a ` +
      `step-by-step action plan to fix it — even with Claude's free help.`;
    return {
      subject,
      text:
        `${domain} — your web exposure diagnosis is one step away.\n\n` +
        `You started the analysis but didn't finish it. Your site stays exposed until you do.\n\n` +
        `For 99€: a clear report with your score, prioritized findings and a step-by-step fix plan.\n\n` +
        `Complete it here: ${resumeUrl}\n\n` +
        `If you'd rather not get more reminders, just ignore this email and we'll stop.`,
      html: wrap(
        "Your diagnosis is one step away",
        [p1, p2, p3],
        CTA.en,
        resumeUrl,
        "If you'd rather not get more reminders, just ignore this email and we'll stop writing.",
      ),
    };
  }

  const p1 =
    `Iniciaste el análisis de <strong>${domain}</strong> pero no llegaste a completarlo. ` +
    `Mientras tanto, tu web sigue expuesta: correos que suplantan tu marca, cabeceras de ` +
    `seguridad ausentes, rutas de administración visibles… cosas que un atacante puede ` +
    `aprovechar y que tus clientes podrían acabar pagando.`;
  const p2 =
    `Recuperar la confianza de un cliente tras un fraude con tu nombre cuesta mucho más ` +
    `que revisar tu web hoy.`;
  const p3 =
    `Por 99€ recibes un informe claro y sin tecnicismos: tu puntuación, los hallazgos ` +
    `priorizados y un plan de acción paso a paso para resolverlo — incluso con la ayuda ` +
    `gratuita de Claude.`;
  return {
    subject,
    text:
      `${domain} — tu diagnóstico de exposición web está a un paso.\n\n` +
      `Iniciaste el análisis pero no lo completaste. Tu web sigue expuesta hasta que lo hagas.\n\n` +
      `Por 99€: un informe claro con tu puntuación, hallazgos priorizados y un plan de acción.\n\n` +
      `Complétalo aquí: ${resumeUrl}\n\n` +
      `Si prefieres no recibir más recordatorios, ignora este correo y dejaremos de escribirte.`,
    html: wrap(
      "Tu diagnóstico está a un paso",
      [p1, p2, p3],
      CTA.es,
      resumeUrl,
      "Si prefieres no recibir más recordatorios, ignora este correo y dejaremos de escribirte.",
    ),
  };
}

function wrap(
  heading: string,
  paras: string[],
  cta: string,
  url: string,
  stopNote: string,
): string {
  return (
    `<div style="margin:0;padding:0;background:#0F1D2E;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto">` +
    `<div style="padding:26px 32px 6px">` +
    `<span style="font-size:22px;font-weight:700;color:#FFFFFF">Turbine<span style="color:#6FBE44">H</span></span>` +
    `<span style="font-size:11px;color:#A7B6C7;letter-spacing:2px;margin-left:8px">SECURITY</span></div>` +
    `<div style="background:#FFFFFF;margin:12px 16px 16px;border-radius:10px;padding:28px;color:#12202F">` +
    `<h1 style="margin:0 0 14px;font-size:20px;color:#0F1D2E">${heading}</h1>` +
    paras
      .map((p) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6">${p}</p>`)
      .join("") +
    `<p style="margin:20px 0"><a href="${url}" style="display:inline-block;background:#6FBE44;color:#0F1D2E;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:8px;font-size:15px">${cta}</a></p>` +
    `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#8496A8">${stopNote}</p>` +
    `</div>` +
    `<div style="padding:0 32px 26px;font-size:11px;color:#A7B6C7">TurbineH Security · security.turbineh.com</div>` +
    `</div></div>`
  );
}
