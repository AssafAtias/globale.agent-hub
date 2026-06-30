/** Replace the value of a `token` query param in a URL string with [REDACTED], preserving everything else. */
export function redactUrlToken(url: string): string {
  return url.replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]');
}
