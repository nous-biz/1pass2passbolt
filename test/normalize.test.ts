import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeItem, parseTotp } from '../src/domain/normalize.ts';
import type { OpItem } from '../src/domain/types.ts';

const item = (overrides: Partial<OpItem>): OpItem => ({
  id: 'op1', title: 'Example', category: 'LOGIN', vault: { name: 'Vault' }, ...overrides,
});

describe('parseTotp', () => {
  it('reads a bare base32 seed with defaults', () => {
    assert.deepEqual(parseTotp('jbsw y3dp-ehpk'), { secret_key: 'JBSWY3DPEHPK', algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('reads an otpauth URI', () => {
    const totp = parseTotp('otpauth://totp/x?secret=abcd&algorithm=sha256&digits=8&period=60');
    assert.deepEqual(totp, { secret_key: 'ABCD', algorithm: 'SHA256', digits: 8, period: 60 });
  });

  it('returns null without a value', () => {
    assert.equal(parseTotp(''), null);
  });
});

describe('normalizeItem', () => {
  it('keeps every field with its original label, in rule order', () => {
    const normalized = normalizeItem(item({
      fields: [
        { type: 'STRING', label: 'Custom', value: 'c' },
        { type: 'CONCEALED', purpose: 'PASSWORD', label: 'password', value: 'p' },
        { type: 'STRING', purpose: 'USERNAME', label: 'login', value: 'u' },
        { type: 'STRING', purpose: 'NOTES', label: 'notesPlain', value: 'n' },
        { type: 'CONCEALED', label: 'Dev Password', value: 'd' },
        { type: 'URL', label: 'admin', value: 'https://admin' },
        { type: 'EMAIL', value: 'a@b.c' },
        { type: 'STRING', label: 'empty', value: '' },
      ],
    }));

    assert.deepEqual(normalized.fields, [
      { label: 'login', value: 'u', kind: 'username' },
      { label: 'password', value: 'p', kind: 'password' },
      { label: 'Dev Password', value: 'd', kind: 'password' },
      { label: 'notes', value: 'n', kind: 'text' },
      { label: 'Custom', value: 'c', kind: 'text' },
      { label: 'admin', value: 'https://admin', kind: 'uri' },
      { label: 'EMAIL', value: 'a@b.c', kind: 'text' },
    ]);
  });

  it('prefers the primary url and parses OTP fields', () => {
    const normalized = normalizeItem(item({
      urls: [{ href: 'https://second' }, { href: 'https://primary', primary: true }],
      fields: [{ type: 'OTP', value: 'ABCD' }],
    }));
    assert.equal(normalized.uri, 'https://primary');
    assert.equal(normalized.totp?.secret_key, 'ABCD');
    assert.equal(normalized.has_content, true);
  });

  it('flags items without content', () => {
    assert.equal(normalizeItem(item({ fields: [] })).has_content, false);
  });

  it('stringifies structured values', () => {
    const normalized = normalizeItem(item({ fields: [{ type: 'ADDRESS', label: 'home', value: { city: 'X' } }] }));
    assert.equal(normalized.fields[0]?.value, '{"city":"X"}');
  });
});
