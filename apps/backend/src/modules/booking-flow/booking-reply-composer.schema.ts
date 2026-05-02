import { z } from 'zod';

export const bookingReplyComposerOutputSchema = z.object({
  reply: z.string(),
  confidence: z.number().min(0).max(1),
});

export type BookingReplyComposerOutput = z.infer<typeof bookingReplyComposerOutputSchema>;
