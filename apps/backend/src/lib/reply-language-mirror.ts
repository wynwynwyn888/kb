/**
 * Customer-language mirroring for live reply generation (OpenAI + MiniMax).
 * Restricted to languages commonly used in Singapore.
 */
export const SINGAPORE_ALLOWED_REPLY_LANGUAGES = [
  'English',
  'Bahasa Malaysia (Malay)',
  'Mandarin Chinese',
  'Tamil',
] as const;

export const REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT =
  'LANGUAGE (strict — Singapore only): Your entire reply MUST use exactly one of these languages: ' +
  'English, Bahasa Malaysia (Malay), Mandarin Chinese, or Tamil. ' +
  'No Portuguese, Spanish, French, Arabic, Hindi, Indonesian, Tagalog, Japanese, Korean, or any other language. ' +
  'Match the customer\'s latest message in this turn (including voice-note transcripts): ' +
  'if they wrote in English, reply in English; if Malay, reply in Bahasa Malaysia; if Chinese, reply in Mandarin; if Tamil, reply in Tamil. ' +
  'If the latest message mixes allowed languages, reply in the dominant allowed language of that message. ' +
  'If the customer wrote in a language outside the four allowed languages, reply in English. ' +
  'Persona instructions, KB excerpts, calendar labels, or business defaults in another language do NOT override this — rewrite into the correct allowed language. ' +
  'Keep proper nouns, brand names, product names, URLs, and times as appropriate. ' +
  'If the latest message is empty or ambiguous (e.g. only "ok" or emoji), use the most recent prior customer message; if still unclear, use English.';
