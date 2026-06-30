import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractStreamResult, summarizeStreamEvent } from '../src/executor.js';

const fixture = readFileSync(join(__dirname, 'fixtures/stream-json-sample.jsonl'), 'utf8').trim().split('\n');

describe('extractStreamResult', () => {
  it('returns the terminal result event string (real fixture)', () => {
    expect(extractStreamResult(fixture)).toBe('ping');
  });
  it('throws when is_error is true', () => {
    const lines = ['{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom"}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('throws when subtype is not success', () => {
    const lines = ['{"type":"result","subtype":"error_max_turns","is_error":false,"result":"x"}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('throws when there is no result event', () => {
    const lines = ['{"type":"system","subtype":"init"}', '{"type":"assistant","message":{"content":[]}}'];
    expect(() => extractStreamResult(lines)).toThrow();
  });
  it('empty/whitespace result -> "(no output)"', () => {
    const lines = ['{"type":"result","subtype":"success","is_error":false,"result":"   "}'];
    expect(extractStreamResult(lines)).toBe('(no output)');
  });
});

describe('summarizeStreamEvent', () => {
  it('system init -> session started', () => {
    expect(summarizeStreamEvent({ type: 'system', subtype: 'init' })).toEqual([{ kind: 'system', label: 'session started' }]);
  });
  it('assistant text block -> responding event', () => {
    const evts = summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at foo.ts now' }] } });
    expect(evts).toEqual([{ kind: 'assistant', label: 'responding', detail: 'Looking at foo.ts now' }]);
  });
  it('assistant tool_use block -> tool event with name + input summary', () => {
    const evts = summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'src/foo.ts' } }] } });
    expect(evts).toEqual([{ kind: 'tool', label: 'Read', detail: 'src/foo.ts' }]);
  });
  it('thinking / result / unknown -> []', () => {
    expect(summarizeStreamEvent({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } })).toEqual([]);
    expect(summarizeStreamEvent({ type: 'result', subtype: 'success' })).toEqual([]);
    expect(summarizeStreamEvent('garbage')).toEqual([]);
  });
});
