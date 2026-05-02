import { describe, expect, it } from '@jest/globals';
import { parseJsonLenient } from './booking-nlu-interpreter.service';
import { bookingNluOutputSchema } from './booking-nlu.schema';

describe('parseJsonLenient', () => {
  it('parses raw JSON object', () => {
    const v = parseJsonLenient('{"intent":"unknown","confidence":0.5}');
    expect(v).toEqual({ intent: 'unknown', confidence: 0.5 });
  });

  it('extracts JSON from surrounding prose', () => {
    const raw = 'Here you go:\n{"intent":"provide_field","confidence":0.9,"fields":{"service":"Haircut","preferredDate":null,"preferredTime":"15:30","preferredTimeWindow":null,"name":null,"phone":null,"email":null,"firstVisit":null,"customAnswers":{}},"slotSelection":{"type":"none","index":null,"time":null},"userFrustrated":false,"notes":null}\nThanks.';
    const v = parseJsonLenient(raw);
    const s = bookingNluOutputSchema.safeParse(v);
    expect(s.success).toBe(true);
    if (s.success) {
      expect(s.data.intent).toBe('provide_field');
      expect(s.data.fields.service).toBe('Haircut');
      expect(s.data.fields.preferredTime).toBe('15:30');
    }
  });
});
