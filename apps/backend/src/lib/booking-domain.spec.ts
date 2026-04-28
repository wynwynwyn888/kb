import {
  assessRestaurantBookingMessage,
  bookingAskPreferredDateTimeReply,
  extractGuestCountHint,
} from './booking-domain';

describe('booking-domain (universal — no service allow-list)', () => {
  it('does NOT reject salon services as out-of-domain', () => {
    // Universal chatbot platform: the booking validity is decided by tenant KB, not by hardcoded lists.
    expect(assessRestaurantBookingMessage('i want to book a haircut for tomorrow').inDomain).toBe(
      true,
    );
    expect(assessRestaurantBookingMessage('book balayage at 3pm').inDomain).toBe(true);
  });

  it('still accepts table booking phrasing (restaurants keep working)', () => {
    expect(assessRestaurantBookingMessage('book table for 2 pax').inDomain).toBe(true);
  });

  it('extracts guest count from pax / party / for N', () => {
    expect(extractGuestCountHint('book for 2 pax')).toBe(2);
    expect(extractGuestCountHint('party of 4')).toBe(4);
    expect(extractGuestCountHint('for 6 people')).toBe(6);
  });

  it('bookingAskPreferredDateTimeReply acknowledges guests when provided', () => {
    expect(bookingAskPreferredDateTimeReply(2)).toContain('2 guests');
    expect(bookingAskPreferredDateTimeReply(null)).toContain('What date and time');
  });
});
