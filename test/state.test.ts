import assert from 'node:assert/strict';
import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
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
  it('keeps the same vault name apart across accounts', async () => {
    const root = await mkdtemp(join(tmpdir(), '1p2pb-'));
    await createStateStore(root, 'a.1password.com').writeVaultItems('V', [{ id: 'a', title: 'A', category: 'LOGIN' }]);
    await createStateStore(root, 'b.1password.com').writeVaultItems('V', [{ id: 'b', title: 'B', category: 'LOGIN' }]);
    assert.deepEqual((await createStateStore(root, 'a.1password.com').readVaultItems('V')).map((i) => i.id), ['a']);
    await assert.rejects(createStateStore(root).readVaultItems('V'), /same --account/);
    await createStateStore(root).clean();
  });

  it('forces 0600 on existing exports and ledgers', async () => {
    const root = await mkdtemp(join(tmpdir(), '1p2pb-'));
    const state = createStateStore(root);
    await state.writeVaultItems('V', [{ id: 'a', title: 'A', category: 'LOGIN' }]);
    const exportFile = join(root, 'default-account', vaultKey('V'), 'items.jsonl');
    await chmod(exportFile, 0o644);
    assert.deepEqual((await state.readVaultItems('V')).map((i) => i.id), ['a']);
    assert.equal((await stat(exportFile)).mode & 0o777, 0o600);

    await writeFile(join(root, 'ledger.tsv'), '', { mode: 0o644 });
    await state.appendLedger({ opId: 'a', vault: 'V', name: 'A\tB', resourceId: 'r1', status: 'created' });
    assert.equal((await stat(join(root, 'ledger.tsv'))).mode & 0o777, 0o600);
    assert.deepEqual([...(await state.readLedger())], [['a', 'r1']]);
    await state.clean();
  });
});
