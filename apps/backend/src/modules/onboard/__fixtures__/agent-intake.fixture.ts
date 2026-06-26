import { PILOT_CLIENT_FIXTURE, PILOT_ANSWERS_FIXTURE, PILOT_ANALYSIS_FIXTURE } from './pilot-client.fixture';

export const SAMPLE_AGENT_INTAKE_PAYLOADS = {
  createSession: {
    projectId: '00000000-0000-0000-0000-000000000001',
    agentType: 'whatsapp_ai',
  },
  submitAnswers: PILOT_ANSWERS_FIXTURE,
  submitAnalysis: PILOT_ANALYSIS_FIXTURE,
  requestReview: {},
};

export const SAMPLE_AGENT_RESPONSES = {
  sessionCreated: {
    sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    projectId: '00000000-0000-0000-0000-000000000001',
    status: 'ACTIVE',
    currentStep: 'business_name',
    totalSteps: 12,
  },
  answersStored: {
    accepted: 5,
    rejected: 0,
    answers: [
      { id: 'a1', section: 'business_profile', questionKey: 'business_name', status: 'stored' },
      { id: 'a2', section: 'business_profile', questionKey: 'description', status: 'stored' },
      { id: 'a3', section: 'prompt', questionKey: 'persona', status: 'stored' },
      { id: 'a4', section: 'faq', questionKey: 'faq_pricing', status: 'stored' },
      { id: 'a5', section: 'faq', questionKey: 'faq_booking', status: 'stored' },
    ],
  },
  analysisStored: {
    analysisStored: true,
    recommendationsStored: 2,
    recommendationIds: ['r1', 'r2'],
  },
};
