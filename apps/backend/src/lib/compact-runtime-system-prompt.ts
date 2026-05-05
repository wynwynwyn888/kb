const DEFAULT_TENANT_CAP = 7500;
const DEFAULT_AGENCY_CAP = 4200;

/**
 * Stored persona/policy stays full-size in DB; generation uses capped bodies to control token burn.
 */
export function compactPersonaPolicyForGeneration(params: {
  tenantPrompt: string;
  agencyPrompt: string;
  tenantCap?: number;
  agencyCap?: number;
}): {
  tenantBody: string;
  agencyBody: string;
  tenantTruncated: boolean;
  agencyTruncated: boolean;
} {
  const tenantCap = params.tenantCap ?? DEFAULT_TENANT_CAP;
  const agencyCap = params.agencyCap ?? DEFAULT_AGENCY_CAP;
  const tp = params.tenantPrompt.trim();
  const ap = params.agencyPrompt.trim();

  const truncate = (body: string, cap: number): { text: string; truncated: boolean } => {
    if (!body) return { text: '', truncated: false };
    const notice = '\n\n[truncated …]';
    if (body.length + notice.length <= cap) return { text: body, truncated: false };
    const take = Math.max(0, cap - notice.length);
    return {
      text: `${body.slice(0, take)}${notice}`,
      truncated: true,
    };
  };

  const tTrunc = truncate(tp, tenantCap);
  const aTrunc = truncate(ap, agencyCap);
  return {
    tenantBody: tTrunc.text,
    agencyBody: aTrunc.text,
    tenantTruncated: tTrunc.truncated,
    agencyTruncated: aTrunc.truncated,
  };
}

/** Rough token estimate (~4 chars per token for Latin scripts). */
export function estimateApproxTokens(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}
