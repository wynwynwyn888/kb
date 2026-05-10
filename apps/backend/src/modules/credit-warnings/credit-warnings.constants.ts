// Defaults for the agency-configurable low-credit warning system.
// Source of truth for both API responses and the SMS render path.

export const DEFAULT_LOW_CREDIT_WARNING_THRESHOLDS: readonly number[] = [2000, 1000, 500, 200];

/**
 * Default WhatsApp/SMS body sent through the agency workspace CRM connection
 * when a client workspace's remaining credits crosses an enabled threshold.
 *
 * Variables:
 *  - {{clientName}}        — `tenants.client_contact_name` (falls back to "there")
 *  - {{workspaceName}}     — client workspace name
 *  - {{remainingCredits}}  — wallet balance after the debit
 *  - {{threshold}}         — the threshold that was crossed
 *  - {{agencyName}}        — agency display name
 *  - {{resetDate}}         — formatted period_end (falls back to "Not configured")
 */
export const DEFAULT_LOW_CREDIT_WARNING_MESSAGE_TEMPLATE = `Hi {{clientName}}, your AISalesBot Pro workspace "{{workspaceName}}" is running low on credits.

Current balance: {{remainingCredits}} credits.
Warning level: {{threshold}} credits.

Please contact us to top up or renew your plan so automated replies can continue without interruption.`;

export type LowCreditWarningStatus = 'SENT' | 'SKIPPED' | 'FAILED';

export type LowCreditWarningSkipReason =
  | 'agency_workspace_crm_not_connected'
  | 'agency_system_workspace_missing'
  | 'client_phone_missing'
  | 'agency_workspace_send_disabled'
  | 'warnings_disabled'
  | 'no_thresholds_configured'
  | 'threshold_already_sent_for_period'
  | 'no_threshold_crossed'
  | 'unlimited_credits'
  | 'is_agency_workspace';

export type LowCreditWarningFailReason =
  | 'send_failed_unknown'
  | 'send_failed_no_contact'
  | 'send_failed_provider'
  | 'send_failed_token_decrypt';

export const ALL_LOW_CREDIT_WARNING_THRESHOLDS = [2000, 1000, 500, 200] as const;
export type AllowedWarningThreshold = (typeof ALL_LOW_CREDIT_WARNING_THRESHOLDS)[number];

export function isAllowedWarningThreshold(n: number): n is AllowedWarningThreshold {
  return ALL_LOW_CREDIT_WARNING_THRESHOLDS.includes(n as AllowedWarningThreshold);
}
