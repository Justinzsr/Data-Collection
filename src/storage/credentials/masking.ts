/**
 * A hint that tells saved values apart without giving much of one away: a
 * character at each end per ten, at most four, and nothing for short values.
 * A ten-character secret shows 2 of its characters, a long token 8.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const edge = Math.min(4, Math.floor(value.length / 10));
  if (edge === 0) return "••••";
  return `${value.slice(0, edge)}••••${value.slice(-edge)}`;
}
