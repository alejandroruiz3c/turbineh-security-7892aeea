// Deterministic scoring rubric for the Web Exposure Diagnosis.
// ---------------------------------------------------------------------------
// CODE owns the score and the per-finding severities — the AI model only
// explains them, it never invents them.
//
// Design goals (from the phase brief):
//   * NON-ALARMIST. Weight by real business impact. Missing CSP or a visible
//     server/tech header alone must NOT push a site into "critical".
//   * The heavy hitters are the ones that actually let an attacker act:
//     no HTTPS (traffic interceptable) and email spoofing exposure (weak or
//     missing DMARC lets anyone forge mail from the domain).
//   * exposed_paths are treated CAUTIOUSLY: a 200 on /wp-admin/ etc. does NOT
//     confirm an exposed panel (SPA/Cloudflare sites soft-200 everything), so
//     the penalties are small and the finding is framed as "worth confirming".
//
// Score starts at 100; documented penalties are subtracted; result clamps to
// [0,100]. Bands: 85-100 low, 65-84 moderate, 40-64 high, 0-39 critical.

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type RiskLevel = "low" | "moderate" | "high" | "critical";

export interface ScoredFinding {
  /** Stable key identifying the signal (for mapping model output back to code). */
  id: string;
  /** Neutral English label; the model rewrites this in the user's language. */
  label: string;
  severity: Severity;
  /** Plain statement of exactly what was observed (grounding fact for the AI). */
  observed: string;
  /** 1..n priority order (1 = most important). */
  priority: number;
}

export interface ScoreResult {
  overall_score: number;
  risk_level: RiskLevel;
  findings: ScoredFinding[];
  /** Transparency: the penalties that produced the score. */
  rubric: { id: string; penalty: number }[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

// deno-lint-ignore no-explicit-any
type Json = any;

function bandFor(score: number): RiskLevel {
  if (score >= 85) return "low";
  if (score >= 65) return "moderate";
  if (score >= 40) return "high";
  return "critical";
}

function present(field: Json): boolean {
  return !!(field && field.present === true);
}

export function computeScore(raw: Json): ScoreResult {
  const findings: ScoredFinding[] = [];
  const rubric: { id: string; penalty: number }[] = [];
  let score = 100;

  const penalize = (
    id: string,
    penalty: number,
    label: string,
    severity: Severity,
    observed: string,
  ) => {
    score -= penalty;
    rubric.push({ id, penalty });
    findings.push({ id, label, severity, observed, priority: 0 });
  };

  const https = raw?.https ?? {};
  const tls = raw?.tls ?? {};
  const headers = raw?.headers ?? {};
  const email = raw?.email ?? {};
  const cookies: Json[] = Array.isArray(raw?.cookies) ? raw.cookies : [];
  const exposed: Json[] = Array.isArray(raw?.exposed_paths) ? raw.exposed_paths : [];
  const tech = raw?.tech ?? {};

  // ---- Transport security (heavy) -----------------------------------------
  if (https.reachable === false) {
    penalize(
      "no_https",
      35,
      "The site is not reachable securely over HTTPS",
      "critical",
      "The external scan could not load the site over HTTPS (https.reachable = false). Visitor traffic may travel unencrypted.",
    );
  } else if (https.reachable === true) {
    // HTTPS works. Reward good redirect / HSTS hygiene by only penalising gaps.
    if (https.http_to_https_redirect === "serves_http_no_redirect") {
      penalize(
        "no_http_redirect",
        8,
        "Insecure HTTP is served without redirecting to HTTPS",
        "medium",
        "Plain http:// is served without redirecting to https:// (http_to_https_redirect = serves_http_no_redirect).",
      );
    }
    if (!present(headers.hsts)) {
      penalize(
        "no_hsts",
        4,
        "HSTS is not enabled",
        "low",
        "No Strict-Transport-Security header was returned on the homepage.",
      );
    }
  }

  // ---- Email spoofing exposure (heavy) ------------------------------------
  const dmarc = email.dmarc ?? {};
  const dmarcPolicy = (dmarc.policy ?? "").toString().toLowerCase();
  if (!present(dmarc)) {
    penalize(
      "dmarc_missing",
      18,
      "No DMARC record — anyone can spoof email from this domain",
      "high",
      "No DMARC record (v=DMARC1) was found in DNS for the domain.",
    );
  } else if (dmarcPolicy === "none") {
    penalize(
      "dmarc_none",
      12,
      "DMARC is monitor-only (p=none) and does not block spoofed email",
      "high",
      "A DMARC record exists but its policy is p=none, which only monitors and does not reject or quarantine forged mail.",
    );
  } else if (dmarcPolicy === "quarantine") {
    penalize(
      "dmarc_quarantine",
      6,
      "DMARC is set to quarantine rather than reject",
      "medium",
      "DMARC policy is p=quarantine; spoofed mail is sent to spam rather than rejected outright.",
    );
  } // p=reject → no finding (good).

  if (!present(email.spf)) {
    penalize(
      "spf_missing",
      8,
      "No SPF record — mail servers can't verify who may send for the domain",
      "medium",
      "No SPF record (v=spf1) was found in DNS for the domain.",
    );
  }

  // ---- Security headers (light) -------------------------------------------
  if (https.reachable !== false) {
    if (!present(headers.content_security_policy)) {
      penalize(
        "no_csp",
        4,
        "No Content-Security-Policy header",
        "low",
        "The homepage response did not include a Content-Security-Policy header.",
      );
    }
    if (!present(headers.x_frame_options)) {
      penalize(
        "no_x_frame_options",
        3,
        "No X-Frame-Options / clickjacking protection",
        "low",
        "No X-Frame-Options header was returned (and no framing directive in CSP was detected).",
      );
    }
    if (!present(headers.x_content_type_options)) {
      penalize(
        "no_x_content_type_options",
        2,
        "No X-Content-Type-Options header",
        "low",
        "No X-Content-Type-Options: nosniff header was returned on the homepage.",
      );
    }
    if (!present(headers.referrer_policy)) {
      penalize(
        "no_referrer_policy",
        1,
        "No Referrer-Policy header",
        "info",
        "No Referrer-Policy header was returned on the homepage.",
      );
    }
  }

  // ---- Cookie flags (only if cookies were observed) -----------------------
  if (cookies.length > 0) {
    const insecure = cookies.filter((c) => c && c.secure !== true);
    const noHttpOnly = cookies.filter((c) => c && c.httponly !== true);
    if (insecure.length > 0) {
      penalize(
        "cookie_not_secure",
        3,
        "A cookie is set without the Secure flag",
        "medium",
        `At least one Set-Cookie lacked the Secure attribute (${insecure.map((c) => c.name).join(", ")}).`,
      );
    }
    if (noHttpOnly.length > 0) {
      penalize(
        "cookie_not_httponly",
        2,
        "A cookie is set without the HttpOnly flag",
        "low",
        `At least one Set-Cookie lacked the HttpOnly attribute (${noHttpOnly.map((c) => c.name).join(", ")}).`,
      );
    }
  }

  // ---- Technology disclosure (very light) ---------------------------------
  if (present(headers.x_powered_by)) {
    penalize(
      "tech_x_powered_by",
      2,
      "The server discloses its technology via X-Powered-By",
      "info",
      `The homepage returned X-Powered-By: ${headers.x_powered_by.value}.`,
    );
  }

  // ---- Exposed paths (CAUTIOUS — presence signal only, not confirmed) -----
  // Cap total exposed-path penalty so a soft-200 SPA can't tank the score.
  let exposedPenalty = 0;
  const EXPOSED_CAP = 10;
  const sensitive: Record<string, { penalty: number; severity: Severity; label: string }> = {
    "/.env": { penalty: 5, severity: "medium", label: "An environment-file path (/.env) responds — worth confirming" },
    "/.git/": { penalty: 5, severity: "medium", label: "A source-control path (/.git/) responds — worth confirming" },
    "/phpinfo.php": { penalty: 3, severity: "medium", label: "A phpinfo path responds — worth confirming" },
    "/server-status": { penalty: 2, severity: "low", label: "A server-status path responds — worth confirming" },
    "/wp-admin/": { penalty: 1, severity: "low", label: "A WordPress admin path appears reachable — worth confirming" },
    "/wp-login.php": { penalty: 1, severity: "low", label: "A WordPress login path appears reachable — worth confirming" },
    "/administrator/": { penalty: 1, severity: "low", label: "An admin path appears reachable — worth confirming" },
    "/admin/": { penalty: 1, severity: "low", label: "An admin path appears reachable — worth confirming" },
  };
  for (const p of exposed) {
    if (!p || p.status !== 200) continue;
    const meta = sensitive[p.path];
    if (!meta) continue;
    if (exposedPenalty >= EXPOSED_CAP) break;
    const applied = Math.min(meta.penalty, EXPOSED_CAP - exposedPenalty);
    exposedPenalty += applied;
    score -= applied;
    rubric.push({ id: `exposed:${p.path}`, penalty: applied });
    findings.push({
      id: `exposed:${p.path}`,
      label: meta.label,
      severity: meta.severity,
      observed:
        `A GET to ${p.path} returned HTTP 200. NOTE: many SPA/Cloudflare sites return 200 for any path, ` +
        `so this is NOT confirmation of an exposed or vulnerable panel — it means the path appears reachable and is worth confirming manually.`,
      priority: 0,
    });
  }

  // ---- Finalise ------------------------------------------------------------
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Order findings by severity (desc) and assign 1..n priority.
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  findings.forEach((f, i) => (f.priority = i + 1));

  return {
    overall_score: score,
    risk_level: bandFor(score),
    findings,
    rubric,
  };
}
