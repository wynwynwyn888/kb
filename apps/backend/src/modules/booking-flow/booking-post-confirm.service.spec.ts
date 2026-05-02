import { describe, expect, it, jest } from '@jest/globals';
import { BookingPostConfirmService } from './booking-post-confirm.service';
import type { GhlService } from '../ghl/ghl.service';
import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';

const coreAll = (): TenantBookingSettingsDto['coreFieldsJson'] => ({
  name: { enabled: true, required: true },
  phone: { enabled: true, required: true },
  email: { enabled: true, required: false },
  service: { enabled: true, required: true },
  preferred_date: { enabled: true, required: true },
  preferred_time: { enabled: true, required: true },
  first_visit: { enabled: true, required: false },
});

const baseDto: TenantBookingSettingsDto = {
  enabled: true,
  bookingMode: 'CHECK_AVAILABILITY',
  defaultGhlCalendarId: 'cal_1',
  defaultGhlCalendarName: 'Main',
  coreFieldsJson: coreAll(),
  customFieldsJson: [],
  maxBookingsPerSlot: 1,
  internalBookingAlertEnabled: false,
  internalBookingAlertNumber: null,
  internalBookingAlertChannel: 'GHL_MESSAGE',
  internalBookingAlertTemplate: null,
};

const slot: AisbpOfferedSlot = {
  option: 1,
  startIso: '2026-05-22T01:00:00.000Z',
  endIso: '2026-05-22T01:30:00.000Z',
  displayText: '9:00 AM',
  calendarId: 'cal_1',
};

const booking: AisbpBookingStateV1 = {
  status: 'confirmed',
  version: 1,
  calendarId: 'cal_1',
  customerName: 'Pat',
  phone: '0262000111',
  service: 'Cut',
  preferredDate: '2026-05-22',
  preferredTime: '09:00',
};

describe('BookingPostConfirmService', () => {
  it('calls updateContact when collected name/phone exist and existing name is empty', async () => {
    const updateContact = jest.fn(async () => ({ success: true }));
    const getContact = jest.fn(async () => ({
      success: true,
      contact: { firstName: '', lastName: '' },
    }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: { name: 'Cal' } })),
      getContact,
      updateContact,
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact: jest.fn(),
      sendMessage: jest.fn(),
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: baseDto,
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(updateContact).toHaveBeenCalled();
  });

  it('skips name update when existing contact has a real name', async () => {
    const updateContact = jest.fn(async () => ({ success: true }));
    const getContact = jest.fn(async () => ({
      success: true,
      contact: { firstName: 'Jordan', lastName: 'Lee' },
    }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact,
      updateContact,
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact: jest.fn(),
      sendMessage: jest.fn(),
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: baseDto,
      picked: slot,
      crmTimeZone: 'UTC',
    });
    const body = updateContact.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(body?.['firstName']).toBeUndefined();
    expect(body?.['phone']).toBeDefined();
  });

  it('updateAppointmentNotes receives summary with appointment id', async () => {
    const updateAppointmentNotes = jest.fn(async () => ({ success: true }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact: jest.fn(async () => ({ success: true })),
      updateAppointmentNotes,
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact: jest.fn(),
      sendMessage: jest.fn(),
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: baseDto,
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(updateAppointmentNotes).toHaveBeenCalled();
    const note = (updateAppointmentNotes.mock.calls[0] ?? [])[1] as string;
    expect(note).toContain('Booking ID: ap1');
  });

  it('when appointment note fails, tries contact note', async () => {
    const addContactNote = jest.fn(async () => ({ success: true }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact: jest.fn(async () => ({ success: true })),
      updateAppointmentNotes: jest.fn(async () => ({ success: false, error: 'nope' })),
      addContactNote,
      createContact: jest.fn(),
      sendMessage: jest.fn(),
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: baseDto,
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(addContactNote).toHaveBeenCalled();
  });

  it('internal alert disabled does not create staff contact', async () => {
    const createContact = jest.fn();
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact: jest.fn(async () => ({ success: true })),
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact,
      sendMessage: jest.fn(),
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: baseDto,
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(createContact).not.toHaveBeenCalled();
  });

  it('internal alert enabled sends SMS to new staff contact', async () => {
    const sendMessage = jest.fn(async () => ({ success: true }));
    const createContact = jest.fn(async () => ({ success: true, contactId: 'staff_ct' }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact: jest.fn(async () => ({ success: true })),
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact,
      sendMessage,
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: {
        ...baseDto,
        internalBookingAlertEnabled: true,
        internalBookingAlertNumber: '+6599990000',
      },
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(createContact).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'staff_ct', channel: 'SMS' }),
    );
  });

  it('internal alert send failure still completes contact update', async () => {
    const sendMessage = jest.fn(async () => ({ success: false, error: 'fail' }));
    const updateContact = jest.fn(async () => ({ success: true }));
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact,
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact: jest.fn(async () => ({ success: true, contactId: 's' })),
      sendMessage,
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking,
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '+6599900111' },
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(updateContact).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it('skips internal alert when alert number matches customer phone digits', async () => {
    const sendMessage = jest.fn();
    const createContact = jest.fn();
    const client = {
      getCalendar: jest.fn(async () => ({ summary: {} })),
      getContact: jest.fn(async () => ({ success: true, contact: {} })),
      updateContact: jest.fn(async () => ({ success: true })),
      updateAppointmentNotes: jest.fn(async () => ({ success: true })),
      addContactNote: jest.fn(async () => ({ success: true })),
      createContact,
      sendMessage,
    };
    const ghl = {
      createGhlClientForConnectedTenantWorkerOrThrow: jest.fn(async () => ({ client, ghlLocationId: 'loc' })),
    } as unknown as GhlService;
    const svc = new BookingPostConfirmService(ghl);
    await svc.runAfterLiveBookingConfirmed({
      tenantId: 't1',
      conversationId: 'c1',
      customerContactId: 'ct1',
      appointmentId: 'ap1',
      booking: { ...booking, phone: '0262000111' },
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '0262000111' },
      picked: slot,
      crmTimeZone: 'UTC',
    });
    expect(createContact).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
