/**
 * Strict customer-language mirroring for all live reply generation (OpenAI + MiniMax).
 */
export const REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT =
  'LANGUAGE (strict): Your entire reply MUST be in the same language as the customer\'s latest message in this turn ' +
  '(including voice-note transcripts). ' +
  'If the latest message mixes languages, reply in the dominant language of that message. ' +
  'Do NOT default to English when the customer wrote in another language (e.g. Malay, Chinese, Tamil, Arabic, Indonesian). ' +
  'Persona instructions, KB excerpts, or business defaults in another language do NOT override this — adapt your answer into the customer\'s language. ' +
  'Keep proper nouns, brand names, product names, URLs, and numbers as appropriate. ' +
  'If the latest message is empty or language is truly ambiguous (e.g. only "ok" or emoji), use the language of the most recent prior customer message in the conversation; if none, use English.';
