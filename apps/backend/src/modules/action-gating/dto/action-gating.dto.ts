// Action gating DTOs

import type { SuggestedAction } from '../../reply-planning/dto';

export { SuggestedAction };

export type ActionIntentStatus = 'SUGGESTED' | 'DEFERRED' | 'BLOCKED' | 'EXECUTED' | 'FAILED';
