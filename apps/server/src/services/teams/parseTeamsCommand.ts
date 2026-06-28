export type TeamsCommand =
  | { kind: 'help' }
  | { kind: 'set-channel'; slug: string }
  | { kind: 'run'; slug: string; input: string }
  | { kind: 'invalid'; reason: string };

export function parseTeamsCommand(raw: string): TeamsCommand {
  // Strip any residual <at>…</at> mention markup botbuilder may leave, collapse whitespace.
  const text = raw.replace(/<at>.*?<\/at>/gi, ' ').replace(/\s+/g, ' ').trim();

  if (text === '' || text.toLowerCase() === 'help') return { kind: 'help' };

  if (text.toLowerCase().startsWith('set-channel')) {
    const slug = text.slice('set-channel'.length).trim();
    if (!slug) return { kind: 'invalid', reason: 'set-channel needs an agent slug' };
    return { kind: 'set-channel', slug: slug.split(/\s+/)[0] };
  }

  // "<slug>: <input>" or "<slug> <input>"
  const colon = text.indexOf(':');
  if (colon > 0) {
    const slug = text.slice(0, colon).trim().split(/\s+/)[0];
    const input = text.slice(colon + 1).trim();
    if (!input) return { kind: 'invalid', reason: `No input provided for agent "${slug}"` };
    return { kind: 'run', slug, input };
  }

  const [slug, ...rest] = text.split(' ');
  const input = rest.join(' ').trim();
  if (!input) return { kind: 'invalid', reason: `No input provided for agent "${slug}"` };
  return { kind: 'run', slug, input };
}
