import { isAllowedUser } from '../../src/services/teams/allowlist.js';

it('allows ids in the list, denies others and undefined', () => {
  expect(isAllowedUser('u1', ['u1', 'u2'])).toBe(true);
  expect(isAllowedUser('u3', ['u1', 'u2'])).toBe(false);
  expect(isAllowedUser(undefined, ['u1'])).toBe(false);
});

it('denies everyone when the allowlist is empty', () => {
  expect(isAllowedUser('u1', [])).toBe(false);
});
