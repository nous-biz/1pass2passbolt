import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMigrationPlan, summarize } from '../src/domain/migration-plan.ts';
import type { NormalizedItem } from '../src/domain/types.ts';

const login = (opId: string, title: string, user = 'u'): NormalizedItem => ({
  vault: 'V', op_id: opId, title, category: 'LOGIN', uri: 'https://x', totp: null, has_content: true,
  fields: [{ label: 'username', value: user, kind: 'username' }, { label: 'password', value: 'p', kind: 'password' }],
});

const resource = (id: string, name: string, username = 'u') => ({ id, name, username, uri: 'https://x' });

const bucketsOf = (entries: ReturnType<typeof buildMigrationPlan>) =>
  Object.fromEntries(entries.map((e) => [e.item.op_id, [e.bucket, 'resourceId' in e ? e.resourceId : undefined]]));

describe('buildMigrationPlan', () => {
  it('creates what is missing and pairs one-to-one matches', () => {
    const entries = buildMigrationPlan([login('a', 'A'), login('b', 'B')], [resource('r1', 'A')], new Map());
    assert.deepEqual(bucketsOf(entries), { a: ['present', 'r1'], b: ['create', undefined] });
  });

  it('matches on username too, not just the name', () => {
    const entries = buildMigrationPlan([login('a', 'A', 'other')], [resource('r1', 'A')], new Map());
    assert.deepEqual(bucketsOf(entries), { a: ['create', undefined] });
  });

  it('treats equal numbers of duplicates as present, without pairing ids', () => {
    const entries = buildMigrationPlan([login('a', 'A'), login('b', 'A')], [resource('r1', 'A'), resource('r2', 'A')], new Map());
    assert.deepEqual(bucketsOf(entries), { a: ['present', undefined], b: ['present', undefined] });
  });

  it('flags more duplicates than resources as ambiguous', () => {
    const entries = buildMigrationPlan([login('a', 'A'), login('b', 'A')], [resource('r1', 'A')], new Map());
    assert.deepEqual(summarize(entries), { create: 0, present: 0, ambiguous: 2, manual: 0 });
  });

  it('trusts the ledger and removes claimed resources from matching', () => {
    const ledger = new Map([['a', 'r1']]);
    const entries = buildMigrationPlan([login('a', 'A'), login('b', 'A')], [resource('r1', 'A')], ledger);
    assert.deepEqual(bucketsOf(entries), { a: ['present', 'r1'], b: ['create', undefined] });
  });

  it('ignores ledger entries whose resource is gone', () => {
    const entries = buildMigrationPlan([login('a', 'A')], [], new Map([['a', 'deleted']]));
    assert.deepEqual(bucketsOf(entries), { a: ['create', undefined] });
  });

  it('sends DOCUMENT items to manual review', () => {
    const doc = { ...login('d', 'Doc'), category: 'DOCUMENT' };
    assert.deepEqual(summarize(buildMigrationPlan([doc], [], new Map())), { create: 0, present: 0, ambiguous: 0, manual: 1 });
  });
});
