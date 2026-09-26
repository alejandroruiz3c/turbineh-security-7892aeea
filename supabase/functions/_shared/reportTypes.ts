/** Stored report payload shared by rendering and delivery. */
export interface ReportFinding {
  title?: string;
  severity?: string;
  priority?: number;
  difficulty?: string;
  time_estimate?: string;
  what_we_detected?: string;
  why_it_matters?: string;
  business_impact?: string;
  recommended_action?: string;
  how_to_fix_with_ai?: string;
  ai_prompt?: string;
  when_to_get_technical_help?: string;
}
export interface Report {
  domain?: string;
  overall_score?: number;
  risk_level?: string;
  executive_summary?: string;
  overall_verdict?: string | null;
  top_priorities?: { title?: string; why_now?: string }[];
  start_with_claude?: { intro?: string; master_prompt?: string } | null;
  findings?: ReportFinding[];
  action_plan?: { next_24h?: string[]; next_7d?: string[]; next_30d?: string[] } | null;
  final_checklist?: string[];
  when_to_get_help?: string | null;
  disclaimer?: string | null;
}
export interface ReportRow extends Report {
  ai_prompts_json?: Report | null;
  findings_json?: ReportFinding[] | null;
  action_plan_json?: Report["action_plan"];
}
