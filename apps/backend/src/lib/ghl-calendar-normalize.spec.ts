import { normalizeGhlCalendarListResponse } from '@aisbp/ghl-client';

describe('normalizeGhlCalendarListResponse', () => {
  it('accepts top-level array', () => {
    expect(normalizeGhlCalendarListResponse([{ id: 'a', name: 'A' }])).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('accepts { calendars: [...] }', () => {
    expect(normalizeGhlCalendarListResponse({ calendars: [{ id: 'x', name: 'X' }] })).toEqual([{ id: 'x', name: 'X' }]);
  });

  it('accepts { data: [...] }', () => {
    expect(normalizeGhlCalendarListResponse({ data: [{ id: 'd', title: 'T' }] })).toEqual([{ id: 'd', name: 'T' }]);
  });

  it('accepts nested data.calendars', () => {
    expect(
      normalizeGhlCalendarListResponse({
        data: { calendars: [{ id: 'n', name: 'Nested' }] },
      }),
    ).toEqual([{ id: 'n', name: 'Nested' }]);
  });
});
