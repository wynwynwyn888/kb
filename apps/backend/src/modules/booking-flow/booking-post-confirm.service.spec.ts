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

function clientBase() {
  return {
    getCalendar: jest.fn(async () => ({ summary: { name: 'Cal' } })),
    updateAppointmentNotes: jest.fn(async () => ({ success: true })),
    addContactNote: jest.fn(async () => ({ success: true })),
    findContactByPhone: jest.fn(async () => ({ success: true, contact: undefined })),
    createContact: jest.fn(),
    sendMessage: jest.fn(),
  };
}

describe('BookingPostConfirmService', () => {
  it('does not call updateContact or getContact (booking safety)', async () => {
    const updateContact = jest.fn();
    const getContact = jest.fn();
    const client = {
      ...clientBase(),
      getContact,
      updateContact,
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
      contactSnapshot: { displayName: 'CRM User', phone: '+6590000000' },
    });
    expect(updateContact).not.toHaveBeenCalled();
    expect(getContact).not.toHaveBeenCalled();
  });

  it('updateAppointmentNotes receives summary with booking intake labels and Contacted from', async () => {
    const updateAppointmentNotes = jest.fn(async () => ({ success: true }));
    const client = {
      ...clientBase(),
      updateAppointmentNotes,
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
      contactSnapshot: { displayName: 'Jordan', phone: '+6511111111' },
    });
    expect(updateAppointmentNotes).toHaveBeenCalled();
    const note = (updateAppointmentNotes.mock.calls[0] ?? [])[1] as string;
    expect(note).toContain('Booking ID: ap1');
    expect(note).toContain('Booking name: Pat');
    expect(note).toContain('Booking phone: 0262000111');
    expect(note).toContain('Contacted from:');
    expect(note).toContain('CRM contact name: Jordan');
    expect(note).toContain('CRM contact phone: +6511111111');
    expect(note).not.toMatch(/conversation id/i);
    expect(note).not.toMatch(/appointment owner/i);
    expect(note).not.toMatch(/contact id/i);
  });

  it('when appointment note fails, tries contact note without profile update', async () => {
    const addContactNote = jest.fn(async () => ({ success: true }));
    const updateContact = jest.fn();
    const client = {
      ...clientBase(),
      updateAppointmentNotes: jest.fn(async () => ({ success: false, error: 'nope' })),
      addContactNote,
      updateContact,
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
    expect(updateContact).not.toHaveBeenCalled();
  });

  it('internal alert disabled does not create staff contact', async () => {
    const createContact = jest.fn();
    const client = {
      ...clientBase(),
      createContact,
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
    const findContactByPhone = jest.fn(async () => ({ success: true, contact: undefined }));
    const client = {
      ...clientBase(),
      findContactByPhone,
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
      booking: { ...booking, phone: '+6599888777' },
      settings: {
        ...baseDto,
        internalBookingAlertEnabled: true,
        internalBookingAlertNumber: '+6599990000',
      },
      picked: slot,
      crmTimeZone: 'UTC',
      contactSnapshot: { phone: '+6511110000' },
    });
    expect(findContactByPhone).toHaveBeenCalledWith('loc', '+6599990000');
    expect(createContact).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'staff_ct', channel: 'SMS' }),
    );
  });

  it('internal alert reuses existing GHL contact by phone (createContact not called)', async () => {
    const sendMessage = jest.fn(async () => ({ success: true }));
    const createContact = jest.fn();
    const findContactByPhone = jest.fn(async () => ({
      success: true,
      contact: { id: 'existing_staff', phone: '+6599990000', name: 'Team' },
    }));
    const client = {
      ...clientBase(),
      findContactByPhone,
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
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '+6599990000' },
      picked: slot,
      crmTimeZone: 'UTC',
      contactSnapshot: { phone: '+6500000001' },
    });
    expect(findContactByPhone).toHaveBeenCalledWith('loc', '+6599990000');
    expect(createContact).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'existing_staff', channel: 'SMS' }),
    );
  });

  it('internal alert duplicate create recovers via second find by phone', async () => {
    const sendMessage = jest.fn(async () => ({ success: true }));
    const createContact = jest.fn(async () => ({
      success: false,
      error: 'This location does not allow duplicated contacts.',
    }));
    const findContactByPhone = jest
      .fn()
      .mockResolvedValueOnce({ success: true, contact: undefined })
      .mockResolvedValueOnce({
        success: true,
        contact: { id: 'recovered_id', phone: '+6599990000' },
      });
    const client = {
      ...clientBase(),
      findContactByPhone,
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
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '+6599990000' },
      picked: slot,
      crmTimeZone: 'UTC',
      contactSnapshot: { phone: '+6511000000' },
    });
    expect(findContactByPhone).toHaveBeenCalledTimes(2);
    expect(createContact).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'recovered_id', channel: 'SMS' }),
    );
  });

  it('internal alert duplicate create with no contact on retry does not send', async () => {
    const sendMessage = jest.fn();
    const createContact = jest.fn(async () => ({
      success: false,
      error: 'This location does not allow duplicated contacts.',
    }));
    const findContactByPhone = jest
      .fn()
      .mockResolvedValueOnce({ success: true, contact: undefined })
      .mockResolvedValueOnce({ success: true, contact: undefined });
    const client = {
      ...clientBase(),
      findContactByPhone,
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
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '+6599990000' },
      picked: slot,
      crmTimeZone: 'UTC',
      contactSnapshot: { phone: '+6511000000' },
    });
    expect(findContactByPhone).toHaveBeenCalledTimes(2);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('internal alert send failure does not call updateContact', async () => {
    const sendMessage = jest.fn(async () => ({ success: false, error: 'fail' }));
    const updateContact = jest.fn();
    const findContactByPhone = jest.fn(async () => ({ success: true, contact: undefined }));
    const client = {
      ...clientBase(),
      findContactByPhone,
      createContact: jest.fn(async () => ({ success: true, contactId: 's' })),
      sendMessage,
      updateContact,
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
      contactSnapshot: { phone: '+6500000001' },
    });
    expect(updateContact).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });

  it('skips internal alert when alert number matches conversation contact phone digits (not booking intake)', async () => {
    const sendMessage = jest.fn();
    const createContact = jest.fn();
    const client = {
      ...clientBase(),
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
      booking: { ...booking, phone: '+6599998888' },
      settings: { ...baseDto, internalBookingAlertEnabled: true, internalBookingAlertNumber: '0262000111' },
      picked: slot,
      crmTimeZone: 'UTC',
      contactSnapshot: { phone: '0262000111' },
    });
    expect(createContact).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends internal alert when team number equals booking intake phone but differs from conversation phone', async () => {
    const sendMessage = jest.fn(async () => ({ success: true }));
    const createContact = jest.fn(async () => ({ success: true, contactId: 'staff_x' }));
    const findContactByPhone = jest.fn(async () => ({ success: true, contact: undefined }));
    const client = {
      ...clientBase(),
      findContactByPhone,
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
      contactSnapshot: { phone: '+6590000001' },
    });
    expect(createContact).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalled();
  });
});
