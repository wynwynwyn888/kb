import type { TenantBookingSettingsDto } from '../booking-settings/booking-settings.service';
import type { BookingReplyComposerNextStep } from './booking-reply-composer.types';
import { expandBookingSelectOptions } from './booking-service-intake';

function serviceMenuExpanded(settings: TenantBookingSettingsDto): string[] | undefined {
  const o = settings.serviceMenuOptions;
  return o?.length ? expandBookingSelectOptions(o) : undefined;
}

export function buildBookingReplyComposerNextStepForAsk(
  fieldId: string,
  settings: TenantBookingSettingsDto,
  safeBaseMessage: string,
): BookingReplyComposerNextStep {
  const so = serviceMenuExpanded(settings);
  switch (fieldId) {
    case 'service':
      return { type: 'ask_service', fieldId, safeBaseMessage, serviceOptions: so };
    case 'preferred_date':
      return { type: 'ask_date', fieldId, safeBaseMessage, serviceOptions: so };
    case 'preferred_time':
      return { type: 'ask_time', fieldId, safeBaseMessage, serviceOptions: so };
    case 'name':
      return { type: 'ask_name', fieldId, safeBaseMessage, serviceOptions: so };
    case 'phone':
      return { type: 'ask_phone', fieldId, safeBaseMessage, serviceOptions: so };
    case 'email':
      return { type: 'ask_email', fieldId, safeBaseMessage, serviceOptions: so };
    case 'first_visit':
      return { type: 'ask_first_visit', fieldId, safeBaseMessage, serviceOptions: so };
    default:
      if (fieldId.startsWith('custom:')) {
        const id = fieldId.slice('custom:'.length);
        const cf = settings.customFieldsJson.find(c => c.id === id);
        const customFieldOptions =
          cf && (cf.fieldType === 'single_select' || cf.fieldType === 'single_choice') && cf.options?.length
            ? expandBookingSelectOptions(cf.options)
            : undefined;
        return { type: 'ask_custom_field', fieldId, safeBaseMessage, serviceOptions: so, customFieldOptions };
      }
      return { type: 'clarify_unknown', fieldId, safeBaseMessage, serviceOptions: so };
  }
}

export function buildOfferSlotsComposerStep(
  safeBaseMessage: string,
  offered: Array<{ option: number; displayText: string }>,
): BookingReplyComposerNextStep {
  return {
    type: 'offer_slots',
    safeBaseMessage,
    offeredSlots: offered.map(o => ({ option: o.option, label: o.displayText })),
  };
}
