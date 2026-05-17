/**
 * Detect customer messages that look like code, shell commands, SQL, or server/ops jargon.
 * Used to avoid breaking character as a coding assistant (especially during human handover).
 */

const CLI_COMMAND_PATTERNS: RegExp[] = [
  /\bdocker\s+(logs?|compose|exec|run|build|pull|push|ps|stop|start|restart)\b/i,
  /\bnpm\s+(run|install|ci|test|start|build)\b/i,
  /\bpnpm\s+(run|install|exec|test|build)\b/i,
  /\byarn\s+(run|install|test|build)\b/i,
  /\bnpx\s+\S+/i,
  /\bgit\s+(push|pull|clone|commit|checkout|merge|rebase|status|log)\b/i,
  /\bcurl\s+(-[a-zA-Z]|\S+\.(com|io|dev|net))\b/i,
  /\bwget\s+\S+/i,
  /\bkubectl\s+\S+/i,
  /\bhelm\s+(install|upgrade|list)\b/i,
  /\bssh\s+[\w@.-]+/i,
  /\bscp\s+\S+/i,
  /\bsystemctl\s+(status|restart|start|stop)\b/i,
  /\bjournalctl\b/i,
  /\bpm2\s+(logs?|restart|start|stop)\b/i,
  /\btail\s+-f\s+\S+/i,
  /\bchmod\s+[0-7]{3,4}\b/i,
  /\bchown\s+\S+/i,
  /\bsudo\s+\S+/i,
  /\bcd\s+\/[\w./-]+/i,
  /\bpython3?\s+[\w./-]+\.py\b/i,
  /\bnode\s+[\w./-]+\.(js|mjs|cjs)\b/i,
];

const SQL_PATTERNS: RegExp[] = [
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+.+\b(FROM|INTO|TABLE|DATABASE|SET|WHERE)\b/is,
  /\bFROM\s+[\w."`]+\s+WHERE\b/is,
  /\bJOIN\s+[\w."`]+\s+ON\b/is,
];

const CODE_SNIPPET_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/,
  /^\s*(import|export|const|let|var|function|class|interface|type|enum)\s+\w/m,
  /^\s*#include\s+[<"]/m,
  /^\s*def\s+\w+\s*\(/m,
  /^\s*public\s+(static\s+)?(void|class)\b/m,
  /;\s*$/m,
];

const SERVER_OPS_JARGON_PATTERNS: RegExp[] = [
  /\b(kubernetes|k8s|containeri[sz]ed|devops|ci\/cd)\b/i,
  /\b(postgres|postgresql|supabase|redis|nginx|traefik)\b/i,
  /\b(api\s+endpoint|reverse\s+proxy|load\s+balancer)\b/i,
  /\b(server|backend|runtime)\s+logs?\b/i,
  /\b(ReferenceError|TypeError|SyntaxError|stack\s+trace|ECONNREFUSED)\b/,
  /\b(prisma\s+(migrate|generate|db\s+push))\b/i,
  /\b(nest\s+build|nest\s+start)\b/i,
  /\b\.env(\.\w+)?\b/i,
  /\bport\s+\d{4,5}\b/i,
];

const SHELL_PROMPT_LINE = /^\s*[$#>]\s+\S/m;

export const TECHNICAL_OPERATOR_DEFLECTION_REPLY =
  "Thanks for your message. I'm here to help with our services and bookings — I can't assist with technical commands or server topics. If you still need a team member, they'll follow up on your request.";

export function isTechnicalOperatorInput(raw: string): boolean {
  const t = raw.trim();
  if (!t || t.length < 3) return false;

  if (SHELL_PROMPT_LINE.test(t)) return true;
  if (CLI_COMMAND_PATTERNS.some(p => p.test(t))) return true;
  if (SQL_PATTERNS.some(p => p.test(t))) return true;
  if (CODE_SNIPPET_PATTERNS.some(p => p.test(t))) return true;
  if (SERVER_OPS_JARGON_PATTERNS.some(p => p.test(t))) return true;

  // Multi-line paste that looks like a script or log dump (not normal chat).
  const lines = t.split(/\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const technicalLineCount = lines.filter(
      l =>
        CLI_COMMAND_PATTERNS.some(p => p.test(l)) ||
        /^\s*(\[Nest\]|ERROR|WARN|DEBUG|INFO)\s/i.test(l) ||
        /^\d{4}-\d{2}-\d{2}[T\s]/.test(l),
    ).length;
    if (technicalLineCount >= 2) return true;
  }

  return false;
}
