export const DEFAULT_CREDIT_RESET_REMINDER_DAYS: readonly number[] = [30, 14, 7, 3, 1];

export const ALL_CREDIT_RESET_REMINDER_DAYS = [30, 14, 7, 3, 1] as const;
export type AllowedResetReminderDay = (typeof ALL_CREDIT_RESET_REMINDER_DAYS)[number];

export function isAllowedResetReminderDay(n: number): n is AllowedResetReminderDay {
  return ALL_CREDIT_RESET_REMINDER_DAYS.includes(n as AllowedResetReminderDay);
}

export const DEFAULT_CREDIT_RESET_REMINDER_MESSAGE_TEMPLATE = `Hi {{clientName}}, your AISalesBot Pro workspace "{{workspaceName}}" credit plan resets on {{resetDate}} ({{daysBefore}} days from now).

Current balance: {{remainingCredits}} credits.

Please contact {{agencyName}} if you need to renew or top up before the reset date.`;
