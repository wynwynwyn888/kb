import { getBusinessLocalNow, getDayPeriodFromLocalHour, greetingLabelForPeriod, resolveAppTimeZone } from './business-time';

describe('business-time', () => {
  it('returns evening / Good evening for 21:00 Asia/Singapore', () => {
    const at = new Date('2026-04-28T13:00:00.000Z'); // 21:00 SGT
    const snap = getBusinessLocalNow('Asia/Singapore', at);
    expect(snap.hour).toBe(21);
    expect(snap.dayPeriod).toBe('evening');
    expect(snap.greetingLabel).toBe('Good evening');
    expect(snap.localIso.startsWith('2026-04-28T21:')).toBe(true);
  });

  it('maps local hours to day periods', () => {
    expect(getDayPeriodFromLocalHour(5)).toBe('morning');
    expect(getDayPeriodFromLocalHour(11)).toBe('morning');
    expect(getDayPeriodFromLocalHour(12)).toBe('afternoon');
    expect(getDayPeriodFromLocalHour(17)).toBe('afternoon');
    expect(getDayPeriodFromLocalHour(18)).toBe('evening');
    expect(getDayPeriodFromLocalHour(0)).toBe('evening');
    expect(getDayPeriodFromLocalHour(4)).toBe('evening');
  });

  it('greeting labels match periods', () => {
    expect(greetingLabelForPeriod('morning')).toBe('Good morning');
    expect(greetingLabelForPeriod('afternoon')).toBe('Good afternoon');
    expect(greetingLabelForPeriod('evening')).toBe('Good evening');
  });

  it('resolveAppTimeZone prefers APP_TIMEZONE then TZ then UTC', () => {
    const prevApp = process.env['APP_TIMEZONE'];
    const prevTz = process.env['TZ'];
    try {
      delete process.env['APP_TIMEZONE'];
      delete process.env['TZ'];
      expect(resolveAppTimeZone()).toBe('UTC');

      process.env['TZ'] = 'Europe/Berlin';
      delete process.env['APP_TIMEZONE'];
      expect(resolveAppTimeZone()).toBe('Europe/Berlin');

      process.env['APP_TIMEZONE'] = 'Pacific/Honolulu';
      process.env['TZ'] = 'Europe/Berlin';
      expect(resolveAppTimeZone()).toBe('Pacific/Honolulu');
    } finally {
      if (prevApp !== undefined) process.env['APP_TIMEZONE'] = prevApp;
      else delete process.env['APP_TIMEZONE'];
      if (prevTz !== undefined) process.env['TZ'] = prevTz;
      else delete process.env['TZ'];
    }
  });
});
