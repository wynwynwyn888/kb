import {
  assessRestaurantBookingMessage,
  bookingAskPreferredDateTimeReply,
  extractGuestCountHint,
  extractOutOfDomainServicePhrase,
} from './booking-domain';

describe('booking-domain', () => {
  it('rejects face wash booking as out of domain', () => {
    expect(assessRestaurantBookingMessage('i want to book face wash for 2pax').inDomain).toBe(false);
  });

  it('accepts table booking phrasing', () => {
    expect(assessRestaurantBookingMessage('book table for 2 pax').inDomain).toBe(true);
  });

  it('extracts guest count from pax', () => {
    expect(extractGuestCountHint('book for 2 pax')).toBe(2);
    expect(extractGuestCountHint('party of 4')).toBe(4);
  });

  it('extractOutOfDomainServicePhrase surfaces matched term', () => {
    const s = extractOutOfDomainServicePhrase('book a facial tomorrow');
    expect(s.toLowerCase()).toContain('facial');
  });

  it('bookingAskPreferredDateTimeReply acknowledges guests', () => {
    expect(bookingAskPreferredDateTimeReply(2)).toContain('2 guests');
    expect(bookingAskPreferredDateTimeReply(null)).toContain('What date and time');
  });
});
