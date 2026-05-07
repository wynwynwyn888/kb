import { Injectable, Logger } from '@nestjs/common';
import type { GhlClient } from '@aisbp/ghl-client';
import { isChannelVerified } from '@aisbp/ghl-client';
import { GhlService } from '../ghl/ghl.service';
import { digitsOnly, maskPhoneForLog } from '../booking-flow/booking-contact-enrichment';
import { truncateForGhlNotes } from '../booking-flow/booking-summary';

function normalizeTeamAlertPhone(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

function isLikelyDuplicateContactError(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('duplicate') ||
    m.includes('already exists') ||
    m.includes('unique constraint') ||
    m.includes('not allow duplicated')
  );
}

export type HumanEscalationNotifyOutcome =
  | 'sent'
  | 'failed'
  | 'skipped_disabled'
  | 'skipped_no_number'
  | 'skipped_same_as_customer_phone'
  | 'skipped_sms_unverified'
  | 'skipped_no_staff_contact';

@Injectable()
export class HumanEscalationNotifyService {
  private readonly logger = new Logger(HumanEscalationNotifyService.name);

  constructor(private readonly ghlService: GhlService) {}

  async sendInternalAlert(params: {
    tenantId: string;
    enabled: boolean;
    teamNotificationNumber: string | null | undefined;
    optionalMessagePrefix: string | null | undefined;
    messageBody: string;
    customerPhoneForDuplicateCheck?: string | null;
  }): Promise<HumanEscalationNotifyOutcome> {
    if (!params.enabled) {
      this.logger.log(`humanEscalationNotifySkipped ${JSON.stringify({ reason: 'disabled' })}`);
      return 'skipped_disabled';
    }
    const rawNum = params.teamNotificationNumber?.trim();
    if (!rawNum) {
      this.logger.log(`humanEscalationSettingsMissing ${JSON.stringify({ reason: 'no_team_notification_number' })}`);
      return 'skipped_no_number';
    }

    let client: GhlClient;
    let ghlLocationId: string;
    try {
      const ctx = await this.ghlService.createGhlClientForConnectedTenantWorkerOrThrow(params.tenantId);
      client = ctx.client;
      ghlLocationId = ctx.ghlLocationId;
    } catch (e) {
      this.logger.warn(
        `humanEscalationNotificationFailed ${JSON.stringify({
          phase: 'ghl_client',
          message: e instanceof Error ? e.message : String(e),
        })}`,
      );
      return 'failed';
    }

    const teamPhone = normalizeTeamAlertPhone(rawNum);
    const toMasked = maskPhoneForLog(teamPhone);
    const alertDigits = digitsOnly(teamPhone);
    const conversationDigits = digitsOnly(params.customerPhoneForDuplicateCheck ?? '');
    if (
      alertDigits.length >= 8 &&
      conversationDigits.length >= 8 &&
      alertDigits === conversationDigits
    ) {
      this.logger.warn(
        `humanEscalationNotifySkipped ${JSON.stringify({
          reason: 'same_as_conversation_contact_phone',
          alertPhone: toMasked,
        })}`,
      );
      return 'skipped_same_as_customer_phone';
    }

    if (!isChannelVerified('SMS')) {
      this.logger.log(`humanEscalationNotifySkipped ${JSON.stringify({ reason: 'sms_channel_unverified' })}`);
      return 'skipped_sms_unverified';
    }

    this.logger.log(`humanEscalationNotificationQueued ${JSON.stringify({ toMasked })}`);

    const { contactId } = await this.resolveStaffAlertContactId(client, ghlLocationId, teamPhone, toMasked);
    if (!contactId) {
      this.logger.log(`humanEscalationNotificationFailed ${JSON.stringify({ phase: 'resolve_contact', toMasked })}`);
      return 'skipped_no_staff_contact';
    }

    const prefix = params.optionalMessagePrefix?.trim() ? `${params.optionalMessagePrefix.trim()}\n\n` : '';
    const body = `${prefix}${params.messageBody}`.trim();
    const send = await client.sendMessage({
      locationId: ghlLocationId,
      contactId,
      message: truncateForGhlNotes(body, 3500),
      channel: 'SMS',
    });
    if (send.success) {
      this.logger.log(`humanEscalationNotificationSent ${JSON.stringify({ toMasked })}`);
      return 'sent';
    }
    this.logger.warn(
      `humanEscalationNotificationFailed ${JSON.stringify({
        phase: 'sendMessage',
        toMasked,
        error: (send.error ?? 'send_failed').slice(0, 120),
      })}`,
    );
    return 'failed';
  }

  private async resolveStaffAlertContactId(
    client: GhlClient,
    ghlLocationId: string,
    teamPhone: string,
    toMasked: string,
  ): Promise<{ contactId?: string }> {
    const findFirst = await client.findContactByPhone(ghlLocationId, teamPhone);
    if (findFirst.success && findFirst.contact?.id) {
      this.logger.log(
        `humanEscalationAlertContactFound ${JSON.stringify({
          toMasked,
          contactIdPrefix: findFirst.contact.id.slice(0, 6),
        })}`,
      );
      return { contactId: findFirst.contact.id };
    }

    const create = await client.createContact({
      phone: teamPhone,
      firstName: 'AISBP',
      lastName: 'Staff alert',
      source: 'AISBP_INTERNAL_HUMAN_ESCALATION',
    });
    if (create.success && create.contactId) {
      this.logger.log(
        `humanEscalationAlertContactCreated ${JSON.stringify({
          toMasked,
          contactIdPrefix: create.contactId.slice(0, 6),
        })}`,
      );
      return { contactId: create.contactId };
    }

    const errMsg = create.error ?? '';
    if (isLikelyDuplicateContactError(errMsg)) {
      this.logger.log(
        `humanEscalationAlertContactCreateDuplicate ${JSON.stringify({
          toMasked,
          error: errMsg.slice(0, 120),
        })}`,
      );
      const findAfter = await client.findContactByPhone(ghlLocationId, teamPhone);
      if (findAfter.success && findAfter.contact?.id) {
        this.logger.log(
          `humanEscalationAlertContactReused ${JSON.stringify({
            reason: 'duplicate_create_recovered',
            toMasked,
            contactIdPrefix: findAfter.contact.id.slice(0, 6),
          })}`,
        );
        return { contactId: findAfter.contact.id };
      }
      this.logger.log(
        `humanEscalationNotificationFailed ${JSON.stringify({
          phase: 'duplicate_recovery',
          toMasked,
          error: (findAfter.error ?? 'contact_not_found_after_duplicate').slice(0, 120),
        })}`,
      );
      return {};
    }

    this.logger.log(
      `humanEscalationNotificationFailed ${JSON.stringify({
        phase: 'createContact',
        toMasked,
        error: errMsg.slice(0, 120),
      })}`,
    );
    return {};
  }
}
