// Placeholder API client exports
// TODO: Implement actual API calls

export const apiClient = {
  // Auth
  login: async (email: string, password: string) => {
    throw new Error('Not implemented');
  },

  // Agencies
  getAgencies: async () => {
    throw new Error('Not implemented');
  },

  // Tenants
  getTenants: async () => {
    throw new Error('Not implemented');
  },

  // Conversations
  getConversations: async (tenantId: string) => {
    throw new Error('Not implemented');
  },

  // Prompts
  getPrompts: async (tenantId: string) => {
    throw new Error('Not implemented');
  },

  // Knowledge Base
  searchKnowledge: async (tenantId: string, query: string) => {
    throw new Error('Not implemented');
  },

  // Quotas
  getQuotaStatus: async (tenantId: string) => {
    throw new Error('Not implemented');
  },
};