import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createStateStore, vaultKey } from '../src/adapters/state.ts';

describe('vaultKey', () => {
  it('keeps names that slugify alike apart', () => {
    assert.notEqual(vaultKey('A/B'), vaultKey('A-B'));
    assert.match(vaultKey('My Vault'), /^my-vault-[0-9a-f]{8}$/);
  });
});

describe('createStateStore', () => {
  it('round-trips items and forces 0600 on a pre-existing ledger', async () => {
    const root = await mkdtemp(join(tmpdir(), '1p2pb-'));
    const state = createStateStore(root);
    await state.writeVaultItems('V', [{ id: 'a', title: 'A', category: 'LOGIN' }]);
    assert.deepEqual((await state.readVaultItems('V')).map((i) => i.id), ['a']);

    await writeFile(join(root, 'ledger.tsv'), '', { mode: 0o644 });
    await state.appendLedger({ opId: 'a', vault: 'V', name: 'A\tB', resourceId: 'r1', status: 'created' });
    assert.equal((await stat(join(root, 'ledger.tsv'))).mode & 0o777, 0o600);
    assert.deepEqual([...(await state.readLedger())], [['a', 'r1']]);
    await state.clean();
  });
});
