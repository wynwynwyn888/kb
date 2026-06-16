import { containsDisallowedSingaporeReplyLanguage } from './reply-language-guard';

describe('containsDisallowedSingaporeReplyLanguage', () => {
  it('flags Portuguese booking drift', () => {
    expect(
      containsDisallowedSingaporeReplyLanguage(
        'Para o dia 19 de junho, temos 2:00 PM disponível. Você gostaria que eu reservasse esse horário?',
      ),
    ).toBe(true);
  });

  it('allows English slot offers', () => {
    expect(
      containsDisallowedSingaporeReplyLanguage(
        'I found some openings for you: 1. 2:00 PM 2. 2:30 PM Which one do you want me to reserve?',
      ),
    ).toBe(false);
  });

  it('allows Tamil script', () => {
    expect(containsDisallowedSingaporeReplyLanguage('நன்றி, உங்கள் பதிவு உறுதி செய்யப்பட்டது.')).toBe(false);
  });

  it('allows Mandarin', () => {
    expect(containsDisallowedSingaporeReplyLanguage('好的，我帮您预约下午2点。')).toBe(false);
  });

  it('flags Spanish', () => {
    expect(containsDisallowedSingaporeReplyLanguage('¿Quiere reservar este horario? Gracias.')).toBe(true);
  });
});
