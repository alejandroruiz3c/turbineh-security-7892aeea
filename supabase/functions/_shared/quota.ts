import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
// Free-tier guardrails: one report per verified email + a daily AI budget cap.
// ---------------------------------------------------------------------------
// Thin wrappers over the SQL functions in the 20260825130000 migration, which
// own the atomicity. Nothing here decides anything on its own — it just calls
// the right function and shapes the user-facing payload the frontend renders.

export const DEFAULT_DAILY_BUDGET_USD = 50;
// Observed real cost of one report is ~$0.45–0.50. Reserve a bit more so a
// pricier-than-usual run can never push the day over the cap.
export const DEFAULT_COST_ESTIMATE_USD = 0.75;

export function dailyBudgetUsd(): number {
  const raw = Number(Deno.env.get("AI_DAILY_BUDGET_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET_USD;
}

export function costEstimateUsd(): number {
  const raw = Number(Deno.env.get("AI_COST_ESTIMATE_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COST_ESTIMATE_USD;
}

// ---------------------------------------------------------------------------
// User-facing payloads
// ---------------------------------------------------------------------------
// Both carry a machine-readable `error` code plus a title/message pair, so the
// frontend can render one dialog component and just print what it is given.

/** 503 body: the whole system hit its daily AI spend cap. */
export function budgetReachedBody(lang: "es" | "en" = "es") {
  return {
    error: "daily_budget_reached",
    title: lang === "en" ? "Daily limit reached" : "Límite diario alcanzado",
    message:
      lang === "en"
        ? "Our analysis system has reached its daily capacity. It becomes " +
          "available again from 00:00 (CET) — please come back then if you " +
          "still need your diagnosis."
        : "Nuestro sistema de análisis ha alcanzado su límite diario de " +
          "capacidad. A partir de las 00:00 volverá a estar disponible: si lo " +
          "necesitas, vuelve entonces y podrás generar tu diagnóstico.",
    retryAfter: "00:00",
  };
}

/** 409 body: this email already used its single free report. */
export function reportLimitBody(lang: "es" | "en" = "es", claimedDomain?: string | null) {
  const dom = claimedDomain ?? null;
  return {
    error: "report_limit_reached",
    title:
      lang === "en" ? "You already used your free report" : "Ya has generado tu informe gratuito",
    message:
      lang === "en"
        ? `You have already generated a free security report${
            dom ? ` for ${dom}` : ""
          } with this email address, so you have reached the limit of one free ` +
          `report per verified email. If you need to analyze another domain, ` +
          `get in touch with us.`
        : `Ya has generado un informe de seguridad gratuito${
            dom ? ` para ${dom}` : ""
          } con este email, así que has alcanzado el límite de un informe ` +
          `gratuito por email verificado. Si necesitas analizar otro dominio, ` +
          `ponte en contacto con nosotros.`,
    claimedDomain: dom,
  };
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface BudgetStatus {
  day: string;
  spent: number;
  cap: number;
  remaining: number;
  exhausted: boolean;
}

/**
 * Read-only: is today's cap already spent? Used for the early dialog on the
 * landing form. Fails OPEN (an infra hiccup must not close the funnel) — the
 * authoritative check is reserveAiBudget, right before we spend money.
 */
// deno-lint-ignore no-explicit-any
export async function aiBudgetStatus(supabase: SupabaseClient): Promise<BudgetStatus | null> {
  const { data, error } = await supabase.rpc("ai_budget_status", {
    p_cap: dailyBudgetUsd(),
  });
  if (error) {
    console.error("aiBudgetStatus: rpc failed (failing open)", error);
    return null;
  }
  return data as BudgetStatus;
}

/**
 * Atomically reserve the estimated cost of one report against today's cap.
 * Returns allowed=false when the run would exceed it. Idempotent per scan.
 *
 * Fails CLOSED on an infra error: the whole point of this function is to be the
 * last line of defence on spend, so if we cannot account for it we do not spend.
 */
// deno-lint-ignore no-explicit-any
export async function reserveAiBudget(
  supabase: SupabaseClient,
  scanRequestId: string,
): Promise<{ allowed: boolean; spent?: number; cap?: number }> {
  const { data, error } = await supabase.rpc("reserve_ai_budget", {
    p_scan_request_id: scanRequestId,
    p_estimate: costEstimateUsd(),
    p_cap: dailyBudgetUsd(),
  });
  if (error) {
    console.error("reserveAiBudget: rpc failed (failing closed)", error);
    return { allowed: false };
  }
  return data as { allowed: boolean; spent?: number; cap?: number };
}

/** Book the real cost once the report exists (replaces the estimate). */
// deno-lint-ignore no-explicit-any
export async function settleAiSpend(
  supabase: SupabaseClient,
  scanRequestId: string,
  actualUsd: number,
): Promise<void> {
  const { error } = await supabase.rpc("settle_ai_spend", {
    p_scan_request_id: scanRequestId,
    p_actual: actualUsd,
  });
  if (error) console.error("settleAiSpend: rpc failed", error);
}

/** Hand the reservation back when the run produced no report. */
// deno-lint-ignore no-explicit-any
export async function releaseAiBudget(
  supabase: SupabaseClient,
  scanRequestId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_ai_budget", {
    p_scan_request_id: scanRequestId,
  });
  if (error) console.error("releaseAiBudget: rpc failed", error);
}

// ---------------------------------------------------------------------------
// One free report per verified email
// ---------------------------------------------------------------------------

export interface ClaimResult {
  allowed: boolean;
  reason?: string;
  claimed_domain?: string | null;
  claimed_at?: string | null;
}

/**
 * Read-only: has this address already used its free report? Advisory pre-check
 * for the landing form (the address typed there is not verified yet, so it is
 * only a hint). Fails OPEN — claimFreeReport is the authority.
 */
// deno-lint-ignore no-explicit-any
export async function hasFreeReportClaim(
  supabase: SupabaseClient,
  email: string,
): Promise<{ claimed: boolean; claimed_domain?: string | null }> {
  const { data, error } = await supabase.rpc("has_free_report_claim", {
    p_email: email,
  });
  if (error) {
    console.error("hasFreeReportClaim: rpc failed (failing open)", error);
    return { claimed: false };
  }
  return data as { claimed: boolean; claimed_domain?: string | null };
}

/**
 * Atomically take the one-and-only free-report slot for a VERIFIED email.
 * Fails CLOSED on an infra error — better to make someone retry than to hand
 * out unlimited free reports.
 */
// deno-lint-ignore no-explicit-any
export async function claimFreeReport(
  supabase: SupabaseClient,
  email: string,
  scanRequestId: string,
  domain: string,
): Promise<ClaimResult> {
  const { data, error } = await supabase.rpc("claim_free_report", {
    p_email: email,
    p_scan_request_id: scanRequestId,
    p_domain: domain,
  });
  if (error) {
    console.error("claimFreeReport: rpc failed (failing closed)", error);
    return { allowed: false, reason: "internal_error" };
  }
  return data as ClaimResult;
}

/** Free the slot when the run failed and the user got nothing. */
// deno-lint-ignore no-explicit-any
export async function releaseFreeReportClaim(
  supabase: SupabaseClient,
  scanRequestId: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_free_report_claim", {
    p_scan_request_id: scanRequestId,
  });
  if (error) console.error("releaseFreeReportClaim: rpc failed", error);
}

/**
 * The address whose control the user actually PROVED for this scan (the one the
 * 6-digit code went to). Falls back to the address on the scan row.
 */
// deno-lint-ignore no-explicit-any
export async function verifiedEmailFor(
  supabase: SupabaseClient,
  scanRequestId: string,
  fallback: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("domain_verifications")
    .select("target_email")
    .eq("scan_request_id", scanRequestId)
    .eq("status", "verified")
    .maybeSingle();
  if (error) console.error("verifiedEmailFor: query failed", error);
  const verified = (data?.target_email ?? "").toString().trim().toLowerCase();
  if (verified) return verified;
  const fb = (fallback ?? "").toString().trim().toLowerCase();
  return fb || null;
}
