import { Injectable, Logger } from '@nestjs/common';
import type { GhlClient } from '@aisbp/ghl-client';
import { isChannelVerified } from '@aisbp/ghl-client';
import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import { GhlService } from '../ghl/ghl.service';
import {
  digitsOnly,
  existingContactDisplayName,
  maskPhoneForLog,
  shouldSkipNameEnrichment,
  splitNameForGhl,
} from './booking-contact-enrichment';
import type { AisbpBookingStateV1, AisbpOfferedSlot } from './conversation-booking-state';
import { buildBookingSummaryText, truncateForGhlNotes } from './booking-summary';

@Injectable()
export class BookingPostConfirmService {
  private readonly logger = new Logger(BookingPostConfirmService.name);

  constructor(private readonly ghlService: GhlService) {}

  /**
   * Best-effort staff persistence after GHL appointment create succeeds.
   * Never throws to the caller — failures are logged only.
   */
  async runAfterLiveBookingConfirmed(params: {
    tenantId: string;
    conversationId: string;
    customerContactId: string;
    appointmentId: string;
    booking: AisbpBookingStateV1;
    settings: TenantBookingSettingsDto;
    picked: AisbpOfferedSlot;
    crmTimeZone: string;
    contactSnapshot?: { displayName?: string; phone?: string; email?: string };
  }): Promise<void> {
    try {
      const { client, ghlLocationId } = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(
        params.tenantId,
      );

      let calendarName = params.settings.defaultGhlCalendarName ?? undefined;
      try {
        const cal = await client.getCalendar(params.booking.calendarId);
        if (cal.summary?.name && !calendarName) calendarName = cal.summary.name;
      } catch {
        // non-fatal
      }

      const summary = buildBookingSummaryText({
        appointmentId: params.appointmentId,
        bookingStatusLabel: 'Confirmed',
        booking: params.booking,
        coreFieldsJson: params.settings.coreFieldsJson,
        customFieldsJson: params.settings.customFieldsJson,
        conversationId: params.conversationId,
        calendarName,
        appointmentOwner: undefined,
        contactPhoneFallback: params.contactSnapshot?.phone,
        selectedSlot: params.picked,
        crmTimeZone: params.crmTimeZone,
      });
      const summaryForSend = truncateForGhlNotes(summary, 8000);
      this.logger.log(
        `bookingSummaryBuilt ${JSON.stringify({
          tenantId: params.tenantId,
          appointmentId: params.appointmentId,
          conversationId: params.conversationId,
          length: summaryForSend.length,
        })}`,
      );

      await this.enrichCustomerContact(client, params);
      await this.persistSummaryNotes(client, params.customerContactId, params.appointmentId, summaryForSend);
      await this.sendInternalStaffAlert(client, ghlLocationId, params, summaryForSend);
    } catch (e) {
      this.logger.warn(
        `bookingPostConfirmFailed ${JSON.stringify({
          tenantId: params.tenantId,
          conversationId: params.conversationId,
          message: e instanceof Error ? e.message : 'unknown',
        })}`,
      );
    }
  }

  private async enrichCustomerContact(
    client: GhlClient,
    params: {
      tenantId: string;
      customerContactId: string;
      booking: AisbpBookingStateV1;
      contactSnapshot?: { displayName?: string; phone?: string; email?: string };
    },
  ): Promise<void> {
    const cid = params.customerContactId?.trim();
    if (!cid) {
      this.logger.log(`contactEnrichmentSkipped ${JSON.stringify({ reason: 'no_contact_id' })}`);
      return;
    }

    const gc = await client.getContact(cid);
    if (!gc.success || !gc.contact) {
      this.logger.log(
        `contactEnrichmentFailed ${JSON.stringify({
          reason: 'get_contact_failed',
          contactIdPrefix: cid.slice(0, 6),
        })}`,
      );
      return;
    }

    const existingName = existingContactDisplayName(gc.contact);
    const collected = params.booking.customerName?.trim();
    const payload: Record<string, unknown> = {};

    if (collected) {
      if (shouldSkipNameEnrichment(existingName)) {
        this.logger.log(
          `contactEnrichmentSkipped ${JSON.stringify({
            reason: 'existing_name',
            hasExisting: true,
          })}`,
        );
      } else {
        const { firstName, lastName } = splitNameForGhl(collected);
        payload['firstName'] = firstName;
        payload['lastName'] = lastName;
      }
    }

    const p = params.booking.phone?.trim();
    if (p) payload['phone'] = p;

    const em = params.booking.email?.trim();
    if (em) payload['email'] = em;

    if (Object.keys(payload).length === 0) {
      this.logger.log(`contactEnrichmentSkipped ${JSON.stringify({ reason: 'nothing_to_write' })}`);
      return;
    }

    const up = await client.updateContact(cid, payload);
    if (up.success) {
      this.logger.log(
        `contactEnrichmentSucceeded ${JSON.stringify({
          keys: Object.keys(payload),
          phoneLogged: p ? maskPhoneForLog(p) : undefined,
        })}`,
      );
    } else {
      this.logger.log(
        `contactEnrichmentFailed ${JSON.stringify({
          error: (up.error ?? 'unknown').slice(0, 120),
        })}`,
      );
    }
  }

  private async persistSummaryNotes(
    client: GhlClient,
    customerContactId: string,
    appointmentId: string,
    summary: string,
  ): Promise<void> {
    const ap = await client.updateAppointmentNotes(appointmentId, summary);
    if (ap.success) {
      this.logger.log(`bookingSummaryNoteCreated ${JSON.stringify({ channel: 'appointment' })}`);
      return;
    }
    this.logger.log(
      `bookingSummaryNoteFailed ${JSON.stringify({
        channel: 'appointment',
        error: (ap.error ?? '').slice(0, 120),
      })}`,
    );

    const cid = customerContactId?.trim();
    if (!cid) {
      this.logger.log(`bookingSummaryPersistenceSkipped ${JSON.stringify({ reason: 'no_contact_for_note' })}`);
      return;
    }
    const cn = await client.addContactNote(cid, summary);
    if (cn.success) {
      this.logger.log(`bookingSummaryNoteCreated ${JSON.stringify({ channel: 'contact_note' })}`);
    } else {
      this.logger.log(
        `bookingSummaryNoteFailed ${JSON.stringify({
          channel: 'contact_note',
          error: (cn.error ?? '').slice(0, 120),
        })}`,
      );
      this.logger.log(`bookingSummaryPersistenceSkipped ${JSON.stringify({ reason: 'appointment_and_note_failed' })}`);
    }
  }

  private async sendInternalStaffAlert(
    client: GhlClient,
    ghlLocationId: string,
    params: {
      tenantId: string;
      conversationId: string;
      customerContactId: string;
      booking: AisbpBookingStateV1;
      settings: TenantBookingSettingsDto;
      contactSnapshot?: { displayName?: string; phone?: string; email?: string };
    },
    summary: string,
  ): Promise<void> {
    const s = params.settings;
    if (!s.internalBookingAlertEnabled) {
      this.logger.log(`bookingInternalAlertSkipped ${JSON.stringify({ reason: 'disabled' })}`);
      return;
    }
    const rawNum = s.internalBookingAlertNumber?.trim();
    if (!rawNum) {
      this.logger.log(`bookingInternalAlertSkipped ${JSON.stringify({ reason: 'no_number' })}`);
      return;
    }

    const alertDigits = digitsOnly(rawNum);
    const customerDigits = digitsOnly(params.booking.phone) || digitsOnly(params.contactSnapshot?.phone);
    if (alertDigits.length >= 8 && customerDigits.length >= 8 && alertDigits === customerDigits) {
      this.logger.warn(
        `bookingInternalAlertSkipped ${JSON.stringify({
          reason: 'same_as_customer_phone',
          alertPhone: maskPhoneForLog(rawNum),
        })}`,
      );
      return;
    }

    if (!isChannelVerified('SMS')) {
      this.logger.log(`bookingInternalAlertSkipped ${JSON.stringify({ reason: 'sms_channel_unverified' })}`);
      return;
    }

    this.logger.log(`bookingInternalAlertQueued ${JSON.stringify({ channel: s.internalBookingAlertChannel })}`);

    const create = await client.createContact({
      phone: rawNum,
      firstName: 'AISBP',
      lastName: 'Staff alert',
      source: 'AISBP_INTERNAL_BOOKING_ALERT',
    });
    if (!create.success || !create.contactId) {
      this.logger.log(
        `bookingInternalAlertFailed ${JSON.stringify({
          error: (create.error ?? 'create_contact_failed').slice(0, 120),
        })}`,
      );
      return;
    }

    const header = s.internalBookingAlertTemplate?.trim()
      ? `${s.internalBookingAlertTemplate.trim()}\n\n`
      : '';
    const body = `${header}${summary}`.trim();
    const send = await client.sendMessage({
      locationId: ghlLocationId,
      contactId: create.contactId,
      message: truncateForGhlNotes(body, 3500),
      channel: 'SMS',
    });
    if (send.success) {
      this.logger.log(`bookingInternalAlertSent ${JSON.stringify({ contactIdPrefix: create.contactId.slice(0, 6) })}`);
    } else {
      this.logger.log(
        `bookingInternalAlertFailed ${JSON.stringify({
          error: (send.error ?? 'send_failed').slice(0, 120),
        })}`,
      );
    }
  }
}
