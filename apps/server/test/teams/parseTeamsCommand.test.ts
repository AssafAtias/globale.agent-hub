import { parseTeamsCommand } from '../../src/services/teams/parseTeamsCommand.js';

describe('parseTeamsCommand', () => {
  it('treats empty / whitespace as help', () => {
    expect(parseTeamsCommand('')).toEqual({ kind: 'help' });
    expect(parseTeamsCommand('   ')).toEqual({ kind: 'help' });
    expect(parseTeamsCommand('help')).toEqual({ kind: 'help' });
  });

  it('parses set-channel', () => {
    expect(parseTeamsCommand('set-channel pr-review')).toEqual({ kind: 'set-channel', slug: 'pr-review' });
  });

  it('reports invalid set-channel without a slug', () => {
    expect(parseTeamsCommand('set-channel')).toEqual({ kind: 'invalid', reason: 'set-channel needs an agent slug' });
  });

  it('parses "<slug>: <input>"', () => {
    expect(parseTeamsCommand('pr-review: check MR 42')).toEqual({ kind: 'run', slug: 'pr-review', input: 'check MR 42' });
  });

  it('parses "<slug> <input>" without a colon', () => {
    expect(parseTeamsCommand('code-reviewer look at this')).toEqual({ kind: 'run', slug: 'code-reviewer', input: 'look at this' });
  });

  it('strips residual <at> mention markup and extra whitespace', () => {
    expect(parseTeamsCommand('<at>Agent Hub</at>  pr-review:  hello ')).toEqual({ kind: 'run', slug: 'pr-review', input: 'hello' });
  });

  it('reports invalid when only a slug is given', () => {
    expect(parseTeamsCommand('pr-review')).toEqual({ kind: 'invalid', reason: 'No input provided for agent "pr-review"' });
  });

  it('treats HELP (uppercase) as help', () => {
    expect(parseTeamsCommand('HELP')).toEqual({ kind: 'help' });
  });

  it('rejects multi-word slug before colon', () => {
    expect(parseTeamsCommand('pr-review please: do this')).toMatchObject({ kind: 'invalid' });
  });
});
