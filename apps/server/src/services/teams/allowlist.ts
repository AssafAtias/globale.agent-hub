export function isAllowedUser(aadObjectId: string | undefined, allowed: string[]): boolean {
  if (!aadObjectId) return false;
  return allowed.includes(aadObjectId);
}
