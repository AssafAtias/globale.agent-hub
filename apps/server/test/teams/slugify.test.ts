import { slugify } from '../../src/services/teams/slugify.js';

it('lowercases and hyphenates', () => {
  expect(slugify('PR Review')).toBe('pr-review');
  expect(slugify('Code  Reviewer!')).toBe('code-reviewer');
  expect(slugify('  Bug Hunter  ')).toBe('bug-hunter');
});
