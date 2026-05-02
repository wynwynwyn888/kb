import { BOOKING_NLU_TIME_WINDOWS, type BookingNluInterpretInput } from './booking-nlu.schema';
import { matchUserLineToMenuOption } from './booking-service-intake';

const WINDOW_SET = new Set<string>(BOOKING_NLU_TIME_WINDOWS);

/**
 * Coerce common model slips so strict Zod validation does not drop the whole NLU payload
 * (e.g. invalid time window enum, noisy firstVisit, custom select phrasing like "no. anything will do").
 */
export function softenBookingNluParsedJson(input: BookingNluInterpretInput, parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const root = { ...(parsed as Record<string, unknown>) };
  const fieldsRaw = root['fields'];
  if (!fieldsRaw || typeof fieldsRaw !== 'object') return parsed;
  const fields = { ...(fieldsRaw as Record<string, unknown>) };

  const win = fields['preferredTimeWindow'];
  if (typeof win === 'string') {
    const w = win.trim().toLowerCase().replace(/\s+/g, '_');
    fields['preferredTimeWindow'] = WINDOW_SET.has(w) ? w : null;
  }

  const fv = fields['firstVisit'];
  if (typeof fv === 'string') {
    const t = fv.trim().toLowerCase().replace(/[.!?]+$/g, '').trim();
    if (t === 'yes' || t === 'y' || t === 'yep' || t === 'yeah' || t === 'yup') fields['firstVisit'] = 'yes';
    else if (t === 'no' || t === 'n' || t === 'nope' || t === 'nah') fields['firstVisit'] = 'no';
    else fields['firstVisit'] = null;
  }

  const pid = input.pendingFieldId?.trim();
  const ca = fields['customAnswers'];
  if (pid?.startsWith('custom:') && ca && typeof ca === 'object' && !Array.isArray(ca)) {
    const id = pid.slice('custom:'.length);
    const defs = input.settingsSummary.customFieldDefs ?? [];
    const def = defs.find(
      d => d.id === id && (d.fieldType === 'single_select' || d.fieldType === 'single_choice') && d.options?.length,
    );
    if (def) {
      const cust = { ...(ca as Record<string, unknown>) };
      const v = cust[id];
      if (typeof v === 'string') {
        const loose = `${input.latestInboundText}\n${v}`;
        const matched =
          matchUserLineToMenuOption(loose, def.options) ??
          matchUserLineToMenuOption(v.replace(/^no[.,!\s]+/i, '').trim(), def.options) ??
          matchUserLineToMenuOption(input.latestInboundText, def.options);
        if (matched) cust[id] = matched;
      }
      fields['customAnswers'] = cust;
    }
  }

  root['fields'] = fields;
  return root;
}
