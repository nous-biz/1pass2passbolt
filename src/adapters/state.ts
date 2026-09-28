import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StatePort } from '../app/ports.ts';
import type { Ledger, OpItem } from '../domain/types.ts';

// Everything under the state dir holds plaintext secrets or internal ids:
// directories are 0700 and files 0600, created that way from the start.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// Readable slug plus a hash of the exact name, so names like "A/B" and
// "A-B" never share (and overwrite) the same directory.
export function vaultKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
  return `${slug}-${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
}

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true, mode: DIR_MODE });
  await chmod(path, DIR_MODE);
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const tsvCell = (value: string) => value.replace(/[\t\n]/g, ' ');

// Exports are namespaced per 1Password account, so the same vault name in
// two accounts can't overwrite each other. The ledger stays shared: op item
// ids are unique across accounts.
export function createStateStore(root: string, account?: string): StatePort {
  const accountDir = join(root, account ? vaultKey(account) : 'default-account');
  const vaultDir = (vaultName: string) => join(accountDir, vaultKey(vaultName));
  const vaultFile = (vaultName: string) => join(vaultDir(vaultName), 'items.jsonl');
  const ledgerFile = join(root, 'ledger.tsv');

  return {
    root,

    async writeVaultItems(vaultName, items) {
      await ensureDir(root);
      await ensureDir(accountDir);
      await ensureDir(vaultDir(vaultName));
      const file = vaultFile(vaultName);
      await writeFile(file, items.map((item) => `${JSON.stringify(item)}\n`).join(''), { mode: FILE_MODE });
      await chmod(file, FILE_MODE);
      return file;
    },

    async readVaultItems(vaultName) {
      const file = vaultFile(vaultName);
      const body = await readOptional(file);
      if (body === null) {
        const forAccount = account ? `account "${account}"` : 'the default account (no --account)';
        throw new Error(`no export of vault "${vaultName}" for ${forAccount} in ${root}; run \`export\` first, with the same --account`);
      }
      await chmod(file, FILE_MODE);
      return body.split('\n').filter(Boolean).map((line) => JSON.parse(line) as OpItem);
    },

    async readLedger() {
      const ledger: Ledger = new Map();
      for (const line of ((await readOptional(ledgerFile)) ?? '').split('\n').filter(Boolean)) {
        const [opId, , , resourceId] = line.split('\t');
        if (opId && resourceId) ledger.set(opId, resourceId);
      }
      return ledger;
    },

    async appendLedger({ opId, vault, name, resourceId, status }) {
      await ensureDir(root);
      const row = [opId, vault, name, resourceId, new Date().toISOString(), status].map(tsvCell).join('\t');
      await appendFile(ledgerFile, `${row}\n`, { mode: FILE_MODE });
      await chmod(ledgerFile, FILE_MODE);
    },

    clean: () => rm(root, { recursive: true, force: true }),
  };
}
