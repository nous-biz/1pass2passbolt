import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createResourceArgs } from '../src/adapters/passbolt.ts';
import { planResource, toCustomFields, TYPES } from '../src/domain/resource-plan.ts';
import type { Field, NormalizedItem } from '../src/domain/types.ts';

const TOTP = { secret_key: 'ABCD', algorithm: 'SHA1', digits: 6, period: 30 };
const username: Field = { label: 'login', value: 'u', kind: 'username' };
const password: Field = { label: 'password', value: 'p', kind: 'password' };
const extra: Field = { label: 'Dev Password', value: 'd', kind: 'password' };

const item = (overrides: Partial<NormalizedItem>): NormalizedItem => ({
  vault: 'V', op_id: 'op1', title: 'T', category: 'LOGIN', uri: 'https://x', totp: null, fields: [], has_content: true, ...overrides,
});

describe('planResource', () => {
  it('uses the native login slots and keeps leftovers as custom fields', () => {
    const plan = planResource(item({ fields: [username, password, extra] }));
    assert.equal(plan?.type, TYPES.DEFAULT);
    assert.equal(plan?.username, 'u');
    assert.equal(plan?.password, 'p');
    assert.deepEqual(plan?.customFields, [extra]);
  });

  it('picks v5-default-with-totp for password + TOTP', () => {
    assert.equal(planResource(item({ fields: [password], totp: TOTP }))?.type, TYPES.DEFAULT_WITH_TOTP);
  });

  it('keeps the username as a custom field on v5-totp-standalone', () => {
    const plan = planResource(item({ fields: [username], totp: TOTP }));
    assert.equal(plan?.type, TYPES.TOTP_STANDALONE);
    assert.equal(plan?.username, null);
    assert.deepEqual(plan?.customFields, [username]);
  });

  it('puts everything in custom fields without password or TOTP', () => {
    const plan = planResource(item({ fields: [username] }));
    assert.equal(plan?.type, TYPES.CUSTOM_FIELDS);
    assert.deepEqual(plan?.customFields, [username]);
  });

  it('returns null for DOCUMENT and empty items', () => {
    assert.equal(planResource(item({ category: 'DOCUMENT', fields: [password] })), null);
    assert.equal(planResource(item({ has_content: false })), null);
  });
});

describe('toCustomFields', () => {
  it('pairs metadata and secret by id and keeps secrets off the metadata side', () => {
    let n = 0;
    const { metadata, secret } = toCustomFields([extra, { label: 'note', value: 'hi', kind: 'text' }], () => `id${(n += 1)}`);
    assert.deepEqual(metadata, [
      { id: 'id1', type: 'password', metadata_key: 'Dev Password' },
      { id: 'id2', type: 'text', metadata_key: 'note', metadata_value: 'hi' },
    ]);
    assert.deepEqual(secret, [
      { id: 'id1', type: 'password', secret_value: 'd' },
      { id: 'id2', type: 'text', secret_value: '' },
    ]);
  });
});

describe('createResourceArgs', () => {
  it('omits --type for the default type and adds TOTP as a secret field', () => {
    const defaultPlan = planResource(item({ fields: [username, password] }));
    assert.ok(defaultPlan);
    assert.deepEqual(createResourceArgs(defaultPlan, 'f1'), [
      'create', 'resource', '--folderParentID', 'f1', '--name', 'T', '--username', 'u', '--uri', 'https://x', '--password', 'p',
    ]);

    const totpPlan = planResource(item({ fields: [password], totp: TOTP }));
    assert.ok(totpPlan);
    const args = createResourceArgs(totpPlan, 'f1');
    assert.deepEqual(args.slice(0, 4), ['create', 'resource', '--type', TYPES.DEFAULT_WITH_TOTP]);
    assert.equal(args.at(-1), `totp=${JSON.stringify(TOTP)}`);
  });
});
