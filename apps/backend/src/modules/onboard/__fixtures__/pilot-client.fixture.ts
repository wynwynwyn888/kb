export const PILOT_CLIENT_FIXTURE = {
  clientKey: 'pilot-test',
  displayName: 'Pilot Test Business',
  contactName: 'Test Owner',
  contactPhone: '+6500001111',
  contactPhoneMasked: '+65****1111',
  contactEmail: 'test@example.com',
  industry: 'Testing',
  websiteUrl: 'https://example.com',
  timezone: 'Asia/Singapore',
};

export const PILOT_PROJECT_FIXTURE = {
  onboardClientId: '00000000-0000-0000-0000-000000000001',
  status: 'DRAFT',
  currentPhase: 'INTAKE',
  version: 1,
};

export const PILOT_AGENT_SESSION_FIXTURE = {
  projectId: '00000000-0000-0000-0000-000000000001',
  agentType: 'whatsapp_ai',
};

export const PILOT_ANSWERS_FIXTURE = {
  answers: [
    {
      section: 'business_profile',
      questionKey: 'business_name',
      questionLabel: 'What is your business name?',
      answerValue: 'Pilot Test Business',
      confidence: 0.98,
      source: 'client_direct',
    },
    {
      section: 'business_profile',
      questionKey: 'description',
      questionLabel: 'Describe your business',
      answerValue: 'A test business for AISBP-Onboard controlled pilot.',
      confidence: 0.95,
      source: 'client_direct',
    },
    {
      section: 'prompt',
      questionKey: 'persona',
      questionLabel: 'How should the bot sound?',
      answerValue: 'Friendly and professional test assistant.',
      confidence: 0.92,
      source: 'client_direct',
    },
    {
      section: 'faq',
      questionKey: 'faq_pricing',
      questionLabel: 'What are your prices?',
      answerValue: 'Our test services range from $10 to $50.',
      confidence: 0.90,
      source: 'client_direct',
    },
    {
      section: 'faq',
      questionKey: 'faq_booking',
      questionLabel: 'How do I book?',
      answerValue: 'Book through our test website at example.com.',
      confidence: 0.93,
      source: 'client_direct',
    },
  ],
};

export const PILOT_ANALYSIS_FIXTURE = {
  summary: 'Test business with simple lead flow. Inquiries come from website and WhatsApp.',
  currentSalesWorkflow: 'Manual replies to inquiries, no automation.',
  leadSources: ['website', 'whatsapp'],
  qualificationProcess: 'Ask about needs and budget.',
  bookingProcess: 'Share booking link.',
  followUpProcess: 'Send reminder before appointment.',
  handoverProcess: 'Escalate complaints to test owner.',
  painPoints: ['manual follow-up', 'missed leads after hours'],
  conversionRisks: ['slow response time'],
  recommendedFocus: 'Automated lead response and booking.',
  confidence: 0.85,
  recommendations: [
    {
      title: 'Auto-reply to new WhatsApp leads',
      description: 'Instantly respond to new inbound WhatsApp messages with qualifying questions.',
      type: 'FOLLOW_UP',
      riskLevel: 'LOW',
      businessValue: 'Reduce response time from hours to seconds.',
      suggestedTrigger: 'New inbound WhatsApp lead',
      suggestedAction: 'Ask qualifying questions and offer booking link',
    },
    {
      title: 'Enable automated booking',
      description: 'Let leads book appointments directly from the conversation.',
      type: 'BOOKING',
      riskLevel: 'LOW',
      businessValue: 'Increase booking conversion rate.',
      suggestedTrigger: 'Lead expresses interest in booking',
      suggestedAction: 'Present available time slots',
    },
  ],
};

export const PILOT_APPROVAL_FIXTURE = {
  approveSection: { comment: 'Looks good.' },
  requestChanges: {
    comment: 'Please update pricing information.',
    rejectedSections: ['faq'],
  },
  rejectProject: { comment: 'Needs major revisions before review.' },
  approveProject: { comment: 'All sections approved. Ready for sync.' },
};

export const PILOT_KB_DRY_RUN_FIXTURE = {
  idempotencyKey: 'pilot-dry-run-001',
};

export const PILOT_KB_APPLY_FIXTURE = {
  syncRunId: '00000000-0000-0000-0000-000000000002',
  confirmApply: true,
  idempotencyKey: 'pilot-apply-001',
  applyScope: 'TENANT_IDENTITY_ONLY',
  operatorNote: 'Controlled pilot — tenant only.',
};
