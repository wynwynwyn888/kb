/** Default menu prompt when no menu KB — single logical message (bubble packing elsewhere). */
export const MENU_CATEGORY_PROMPT = `I can help with the menu.

Our menu covers:
A) Starters
B) Mains
C) Desserts
D) Vegan options

What are you in the mood for?`;

export function menuCategorySelectedNoKbReply(categoryLabel: string): string {
  const catLower = (categoryLabel.trim() || 'that category').toLowerCase();
  return (
    `Sure — ${catLower}.\n\n` +
    `I don't have the full ${catLower} details here yet. Would you like the team to send you the menu?`
  );
}

export const SELECTION_UNCLEAR_REPLY =
  'Which option did you mean — A, B, C, or D? Reply with the letter.';
