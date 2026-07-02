import { users, runners, runs, agents } from '../src/db/schema.js';

describe('multi-user schema columns', () => {
  it('declares the new columns', () => {
    expect(Object.keys(users)).toEqual(expect.arrayContaining(['entraObjectId', 'name']));
    expect(Object.keys(runners)).toEqual(expect.arrayContaining(['userId']));
    expect(Object.keys(runs)).toEqual(expect.arrayContaining(['userId']));
    expect(Object.keys(agents)).toEqual(expect.arrayContaining(['ownerId']));
  });
});
