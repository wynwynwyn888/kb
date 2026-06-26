import type { KbSyncPlan, KbSyncWriteOp } from './onboard-kb-sync.types';

export function mapOnboardToKbPlan(params: {
  tenantName: string;
  agencyId: string;
  clientContactName?: string | null;
  clientContactPhone?: string | null;
  clientContactEmail?: string | null;
  persona?: string | null;
  conversationGoals?: string | null;
  businessNotes?: string | null;
  toneRules?: string | null;
  maxReplyTokens?: number | null;
  faqItems?: Array<{ question: string; answer: string; category?: string }>;
  bookingEnabled?: boolean;
  bookingLink?: string | null;
  leadFields?: string[];
  followUpEnabled?: boolean;
  followUpGoal?: string | null;
  followUpCadenceHours?: number | null;
  handoverEnabled?: boolean;
  handoverPhone?: string | null;
}): KbSyncPlan[] {
  const plans: KbSyncPlan[] = [];

  // Phase 1: Tenant + Identity
  plans.push({
    phase: 1,
    phaseName: 'Tenant & Identity Map',
    operations: [
      {
        table: 'tenants',
        operation: 'CREATE',
        fields: {
          agency_id: params.agencyId,
          name: params.tenantName,
          status: 'active',
          client_contact_name: params.clientContactName ?? null,
          client_contact_phone: params.clientContactPhone ?? null,
          client_contact_email: params.clientContactEmail ?? null,
        },
        notes: 'Uses TenantsService.createTenant(). Status set to active. GHL location deferred.',
      },
      {
        table: 'onboarding_identity_map',
        operation: 'UPDATE',
        fields: { kb_tenant_id: '<generated>' },
        notes: 'Update after tenant creation with new tenant ID.',
      },
    ],
    preconditions: ['operator has agency membership', 'agencyId is valid'],
    rollbackNotes: 'Manual: pause bot in KB dashboard; delete tenant if no conversations exist.',
  });

  // Phase 2: Knowledge Base
  if (params.faqItems && params.faqItems.length > 0) {
    const faqOps: KbSyncWriteOp[] = params.faqItems.map((faq, i) => ({
      table: 'knowledge_documents',
      operation: 'CREATE' as const,
      fields: {
        title: faq.question,
        document_kind: 'faq',
        status: 'READY',
        metadata: { question: faq.question, category: faq.category || 'OTHER' },
      },
      notes: `FAQ item ${i + 1}. Answer becomes single KnowledgeChunk via KbService.createFaq().`,
    }));

    plans.push({
      phase: 2,
      phaseName: 'Knowledge Base',
      operations: [
        {
          table: 'knowledge_vaults',
          operation: 'CREATE',
          fields: { name: 'Onboard Config' },
          notes: 'Create default vault. Use KbService.ensureDefaultVaultForTenant().',
        },
        ...faqOps,
      ],
      preconditions: ['tenant created', 'default vault exists'],
      rollbackNotes: 'Manual: delete documents from KB Knowledge Vault UI.',
    });
  }

  // Phase 3: Bot Profile + Prompt Config
  if (params.persona) {
    plans.push({
      phase: 3,
      phaseName: 'Bot Profile & Prompt Config',
      operations: [
        {
          table: 'tenant_bot_profiles',
          operation: 'CREATE',
          fields: {
            name: 'Default',
            persona: params.persona ?? '',
            conversation_goals: params.conversationGoals ?? '',
            business_notes: params.businessNotes ?? '',
            tone_rules: params.toneRules ?? '',
            is_active: true,
          },
          notes: 'Uses BotProfilesService.createBotProfile() with setActive: true.',
        },
        {
          table: 'tenant_prompt_configs',
          operation: 'CREATE',
          fields: {
            temperature: 0.7,
            max_tokens: params.maxReplyTokens ?? 800,
            is_active: true,
          },
          notes: 'Linked via bot_profile_id. Created automatically by createBotProfile().',
        },
      ],
      preconditions: ['tenant created'],
      rollbackNotes: 'Manual: delete bot profile from KB Assistant UI; system regenerates default.',
    });
  }

  // Phase 4: Automation Settings
  const autoOps: KbSyncWriteOp[] = [];

  if (params.bookingEnabled) {
    autoOps.push({
      table: 'tenant_booking_settings',
      operation: 'UPSERT',
      fields: {
        enabled: true,
        booking_mode: 'COLLECT_DETAILS_ONLY',
        core_fields_json: params.leadFields?.map(f => ({ [f]: { enabled: true, required: true } })) ?? {},
        default_ghl_calendar_id: params.bookingLink ?? null,
      },
      notes: 'Uses BookingSettingsService.patchBookingSettings(). Upsert via tenantId PK.',
    });
  }

  if (params.followUpEnabled) {
    autoOps.push({
      table: 'tenant_follow_up_settings',
      operation: 'UPSERT',
      fields: {
        enabled: false, // CRITICAL: never enable outbound
        max_follow_ups: 3,
        steps_json: [{
          stepNumber: 1,
          delayAmount: params.followUpCadenceHours ?? 24,
          delayUnit: 'hours',
          mode: 'ai_decides',
          aiInstruction: params.followUpGoal ?? 'Follow up with lead.',
          enabled: true,
        }],
      },
      notes: 'Enabled is FALSE. Steps use ai_decides mode only — no fixed_message auto-send. Uses FollowUpSettingsService.patchFollowUpSettings().',
    });
  }

  if (params.handoverEnabled && params.handoverPhone) {
    autoOps.push({
      table: 'tenant_human_escalation_settings',
      operation: 'UPSERT',
      fields: {
        enabled: true,
        team_notification_number: params.handoverPhone,
      },
      notes: 'Uses HumanEscalationSettingsService.patchSettings(). Phone masked in payload.',
    });
  }

  if (autoOps.length > 0) {
    plans.push({
      phase: 4,
      phaseName: 'Automation Settings',
      operations: autoOps,
      preconditions: ['tenant created', 'operator-approved recommendations exist for each setting'],
      rollbackNotes: 'Manual: disable settings in KB Automation UI.',
    });
  }

  return plans;
}
