import axios from 'axios';

/** Redact obvious secrets before logging HTTP error bodies. */
export function redactForLogs(text: string, maxLen = 2500): string {
  let s = text.length > maxLen ? `${text.slice(0, maxLen)}…(truncated)` : text;
  s = s.replace(/\bBearer\s+[A-Za-z0-9._\-]+\b/gi, 'Bearer [REDACTED]');
  s = s.replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, 'sk-[REDACTED]');
  s = s.replace(/"api_key"\s*:\s*"[^"]+"/gi, '"api_key":"[REDACTED]"');
  s = s.replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[REDACTED]"');
  return s;
}

/** Safe one-line summary for logs (no request headers / no keys). */
export function summarizeAxiosErrorForLogs(err: unknown, context: string): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const statusText = err.response?.statusText;
    let detail = '';
    const data = err.response?.data;
    try {
      if (data != null) {
        const raw = typeof data === 'string' ? data : JSON.stringify(data);
        detail = redactForLogs(raw);
      }
    } catch {
      detail = '(unserializable response body)';
    }
    const base = `HTTP ${status ?? '?'}${statusText ? ` ${statusText}` : ''} ${context}`;
    return detail ? `${base} | body=${detail}` : `${base} | ${err.message}`;
  }
  if (err instanceof Error) return `${context}: ${err.message}`;
  return `${context}: ${String(err)}`;
}
