export const VALID_SECTION_NAMES = [
  'business_profile',
  'sales_process',
  'faq',
  'prompt',
  'handover',
  'follow_up',
] as const;

export type SectionName = (typeof VALID_SECTION_NAMES)[number];

export function isValidSection(name: string): name is SectionName {
  return VALID_SECTION_NAMES.includes(name as SectionName);
}

export const SECTION_TABLE_MAP: Record<SectionName, string> = {
  business_profile: 'business_profiles',
  sales_process: 'sales_process_maps',
  faq: 'faq_items',
  prompt: 'prompt_configs',
  handover: 'handover_rules',
  follow_up: 'follow_up_rules',
};

export const ALLOWED_APPROVAL_TRANSITIONS: Record<string, string[]> = {
  EMPTY: ['PARTIAL'],
  PARTIAL: ['COMPLETE', 'EMPTY'],
  COMPLETE: ['APPROVED', 'REJECTED', 'PARTIAL'],
  APPROVED: ['REJECTED', 'PARTIAL'],
  REJECTED: ['PARTIAL', 'COMPLETE'],
};

export const ALLOWED_PROJECT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  SUBMITTED: ['IN_REVIEW', 'CHANGES_REQUESTED', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'ARCHIVED'],
  CHANGES_REQUESTED: ['SUBMITTED', 'ARCHIVED'],
  APPROVED: ['SYNCING', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
};

export const REQUIRED_SECTIONS_FOR_APPROVAL: SectionName[] = [
  'business_profile',
  'prompt',
];
