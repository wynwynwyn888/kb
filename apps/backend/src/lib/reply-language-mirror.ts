/** Customer-language mirroring for live reply generation (OpenAI + MiniMax). */
export const REPLY_LANGUAGE_MIRROR_SYSTEM_CONTENT =
  'LANGUAGE: Match the language of the customer\'s latest message in this turn, including voice-note transcripts. ' +
  'If the latest message mixes languages, reply in its dominant language. ' +
  'Persona instructions, knowledge excerpts, calendar labels, and business defaults do not override the customer\'s language. ' +
  'Keep proper nouns, brand names, product names, URLs, and times as appropriate. ' +
  'If the latest message is empty or ambiguous (for example only "ok" or an emoji), use the most recent prior customer message; if still unclear, use English.';
