const BAD_EMAIL_PATTERNS = /@(gmail|yahoo|hotmail|outlook|icloud|proton)\.[a-z]+$/i;
const FULL_PHONE_RE = /\+[0-9]{8,15}/;
const TOKEN_OR_KEY_RE = /sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{10,}|[A-Za-z0-9]{40,}/;
const SECRET_RE = /(secret|password|token|api[_-]?key)[=:]\s*[A-Za-z0-9\-_]{8,}/i;

export interface FixtureSafetyResult {
  name: string;
  safe: boolean;
  issues: string[];
}

export function validateFixtureSafety(
  name: string,
  data: unknown,
  context = '',
): FixtureSafetyResult {
  const result: FixtureSafetyResult = { name, safe: true, issues: [] };
  const json = JSON.stringify(data);

  // Check for real-looking emails
  const emails = json.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const badEmails = emails.filter(e => BAD_EMAIL_PATTERNS.test(e) || !e.includes('example.com'));
  if (badEmails.length > 0) {
    result.safe = false;
    result.issues.push(`${context}Suspicious emails: ${badEmails.join(', ')}`);
  }

  // Check for full phone numbers (not masked)
  const phones = json.match(FULL_PHONE_RE) || [];
  const fullPhones = phones.filter(p => p.length > 10 && !p.includes('****'));
  if (fullPhones.length > 0) {
    result.issues.push(`${context}Full phone numbers found: ${fullPhones.join(', ')}`);
    // Warning only — test fixture phones like +6500001111 are acceptable for test data
  }

  // Check for token/API key patterns
  if (TOKEN_OR_KEY_RE.test(json)) {
    result.safe = false;
    result.issues.push(`${context}Possible token or API key pattern detected`);
  }

  // Check for secrets
  if (SECRET_RE.test(json)) {
    result.safe = false;
    result.issues.push(`${context}Possible secret/credential pattern detected`);
  }

  return result;
}

export function validateNoGhlMutation(data: Record<string, unknown>): FixtureSafetyResult {
  const result: FixtureSafetyResult = { name: 'GHL mutation check', safe: true, issues: [] };
  const json = JSON.stringify(data);

  // Skip if explicitly marked safe
  if (json.includes('"noGhlMutation": true') || json.includes('"noWrite": true') || json.includes('"noGhlApiCalls": true')) {
    return result;
  }

  // Flag only actual GHL mutation operations — not descriptive text
  if (json.includes('ghl_contacts') || json.includes('ghl_opportunities') || json.includes('ghl_workflows')) {
    result.safe = false;
    result.issues.push('GHL mutation table reference found without safety flag');
  }
  return result;
}

export function validateNoExecution(data: Record<string, unknown>): FixtureSafetyResult {
  const result: FixtureSafetyResult = { name: 'Execution safety check', safe: true, issues: [] };
  const json = JSON.stringify(data);

  if (json.includes('"outboundEnabled": true')) {
    result.safe = false;
    result.issues.push('outboundEnabled is true');
  }
  if (json.includes('"botProfileActive": true')) {
    result.safe = false;
    result.issues.push('botProfileActive is true');
  }
  if (json.includes('"followUpEnabled": true') || json.includes('"followUpExecutionEnabled": true')) {
    result.safe = false;
    result.issues.push('Follow-up execution is enabled');
  }
  if (json.includes('"bookingEnabled": true')) {
    result.safe = false;
    result.issues.push('Booking execution is enabled');
  }
  if (json.includes('"handoverEnabled": true')) {
    result.safe = false;
    result.issues.push('Handover execution is enabled');
  }
  if (json.includes('"noMessagesSent": false')) {
    result.safe = false;
    result.issues.push('Messages sent flag is not true');
  }

  return result;
}
