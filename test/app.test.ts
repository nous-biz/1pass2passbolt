import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveFolder } from '../src/app/folder.ts';
import { runImport } from '../src/app/migrate.ts';
import { PartialResourceError, type Deps, type LedgerStatus, type PassboltPort } from '../src/app/ports.ts';
import { compareResource } from '../src/app/verify.ts';
import { planResource } from '../src/domain/resource-plan.ts';
import type { ExistingResource, OpItem } from '../src/domain/types.ts';

const opItem = (id: string, title: string): OpItem => ({
  id, title, category: 'LOGIN', vault: { name: 'V' },
  fields: [
    { type: 'STRING', purpose: 'USERNAME', label: 'username', value: 'u' },
    { type: 'CONCEALED', purpose: 'PASSWORD', label: 'password', value: 'p' },
  ],
});

function fakePassbolt(folders: { id: string; name: string }[], existing: ExistingResource[] = []): PassboltPort & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    listFolders: async () => folders,
    createFolder: async () => 'new-folder',
    listResources: async () => existing,
    getResource: async () => ({}),
    createResource: async (plan) => {
      if (plan.name === 'Broken') throw new PartialResourceError('r-broken', 'attach failed');
      created.push(plan.name);
      return `r-${plan.name}`;
    },
  };
}

function fakeDeps(passbolt: PassboltPort, items: OpItem[]): Deps & { ledgerRows: { opId: string; status: LedgerStatus }[] } {
  const ledgerRows: { opId: string; status: LedgerStatus }[] = [];
  return {
    ledgerRows,
    passbolt,
    onePassword: {} as Deps['onePassword'],
    log: { info: () => {}, error: () => {}, progress: () => {} },
    state: {
      root: '/tmp/x',
      writeVaultItems: async () => '',
      readVaultItems: async () => items,
      readLedger: async () => new Map(),
      appendLedger: async ({ opId, status }) => void ledgerRows.push({ opId, status }),
      clean: async () => {},
    },
  };
}

describe('resolveFolder', () => {
  it('refuses several exact matches and case-only near matches', async () => {
    await assert.rejects(resolveFolder(fakePassbolt([{ id: '1', name: 'A' }, { id: '2', name: 'A' }]), { folderName: 'A' }), /2 folders/);
    await assert.rejects(resolveFolder(fakePassbolt([{ id: '1', name: 'Employee' }]), { folderName: 'employee' }), /"Employee"/);
  });

  it('returns a null id when the folder does not exist', async () => {
    assert.deepEqual(await resolveFolder(fakePassbolt([]), { folderName: 'New' }), { id: null, name: 'New' });
  });
});

describe('runImport', () => {
  it('writes nothing to Passbolt when the user declines', async () => {
    const passbolt = fakePassbolt([{ id: 'f', name: 'V' }]);
    const result = await runImport(fakeDeps(passbolt, [opItem('a', 'A')]), { vault: 'V', folderName: 'V', confirm: async () => false });
    assert.equal(result.created, 0);
    assert.deepEqual(passbolt.created, []);
  });

  it('creates missing items, records matches, and records partial failures', async () => {
    const passbolt = fakePassbolt([{ id: 'f', name: 'V' }], [{ id: 'r-A', name: 'A', username: 'u', uri: '' }]);
    const deps = fakeDeps(passbolt, [opItem('a', 'A'), opItem('b', 'B'), opItem('c', 'Broken')]);
    const result = await runImport(deps, { vault: 'V', folderName: 'V', confirm: async () => true });

    assert.deepEqual(passbolt.created, ['B']);
    assert.deepEqual({ created: result.created, failed: result.failed }, { created: 1, failed: 1 });
    assert.deepEqual(deps.ledgerRows, [
      { opId: 'a', status: 'matched' },
      { opId: 'b', status: 'created' },
      { opId: 'c', status: 'partial' },
    ]);
  });
});

describe('compareResource', () => {
  it('reports mismatching labels only', () => {
    const plan = planResource({
      vault: 'V', op_id: 'a', title: 'A', category: 'LOGIN', uri: null, totp: null, has_content: true,
      fields: [
        { label: 'password', value: 'p', kind: 'password' },
        { label: 'API key', value: 'k', kind: 'password' },
        { label: 'note', value: 'n', kind: 'text' },
      ],
    });
    assert.ok(plan);
    const resource = {
      name: 'A', password: 'p',
      metadata: { custom_fields: [{}, { metadata_value: 'changed' }] },
      secret: { custom_fields: [{ secret_value: 'k' }, {}] },
    };
    assert.deepEqual(compareResource(plan, resource), ['note']);
  });
});
