export function buildUpdateClause(patch: Record<string, unknown>, startIndex = 1) {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return {
    clause: entries.map(([column], index) => `${column} = $${startIndex + index}`).join(", "),
    values: entries.map(([, value]) => value),
  };
}
