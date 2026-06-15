/** Customer asks whether the bot can see / understand photos (text turn, no image attached). */
export function userAsksAboutImageCapability(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(understand|interpret|analyze|analyse|see|view|read)\b.*\b(image|images|photo|photos|picture|pictures|pic)\b/i.test(t) ||
    /\b(image|photo|picture|pic)\b.*\b(understand|see|view|work)\b/i.test(t) ||
    /\bcan you (see|understand|interpret) (this|my|the)? *(image|photo|picture)/i.test(t) ||
    /\bdo you (support|accept) (image|photo|picture)/i.test(t)
  );
}

/** Customer asks about a photo they already sent (text follow-up, no new attachment). */
export function userAsksAboutRecentPhotoContent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /\bwhat('?s| is) (in )?(the |this |my )?(photo|picture|image)\b/i.test(t) ||
    /\b(describe|explain) (the |this |my )?(photo|picture|image)\b/i.test(t) ||
    /\bwhat do you see\b/i.test(t) ||
    /\bwhats the photo\b/i.test(t)
  );
}
