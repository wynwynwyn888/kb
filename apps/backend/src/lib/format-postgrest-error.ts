/** Supabase/PostgREST errors are plain objects; stringify for logs (avoid `[object Object]`). */
export function formatPostgrestError(err: unknown): string {
  if (err == null) return 'null';
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    const msg = typeof o['message'] === 'string' ? o['message'] : '';
    const code = typeof o['code'] === 'string' ? o['code'] : '';
    const details = typeof o['details'] === 'string' ? o['details'] : '';
    const hint = typeof o['hint'] === 'string' ? o['hint'] : '';
    const parts = [
      msg,
      code ? `code=${code}` : '',
      details ? `details=${details}` : '',
      hint ? `hint=${hint}` : '',
    ].filter(Boolean);
    if (parts.length) return parts.join(' | ');
  }
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
