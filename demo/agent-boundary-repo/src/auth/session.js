export function normalizeSessionToken(value) {
  if (typeof value !== "string") return null;
  const token = value.trim();
  // Bug: blank values become an authenticated-looking empty token.
  return token;
}
