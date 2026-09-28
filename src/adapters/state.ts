import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StatePort } from '../app/ports.ts';
import type { Ledger, OpItem } from '../domain/types.ts';

// Everything under the state dir holds plaintext secrets or internal ids:
// directories are 0700 and files 0600, created that way from the start.
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
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

export function createStateStore(root: string): StatePort {
  const vaultDir = (vaultName: string) => join(root, slugify(vaultName));
  const vaultFile = (vaultName: string) => join(vaultDir(vaultName), 'items.jsonl');
  const ledgerFile = join(root, 'ledger.tsv');

  return {
    root,

    async writeVaultItems(vaultName, items) {
      await ensureDir(root);
      await ensureDir(vaultDir(vaultName));
      const file = vaultFile(vaultName);
      await writeFile(file, items.map((item) => `${JSON.stringify(item)}\n`).join(''), { mode: FILE_MODE });
      await chmod(file, FILE_MODE);
      return file;
    },

    async readVaultItems(vaultName) {
      const body = await readOptional(vaultFile(vaultName));
      if (body === null) throw new Error(`no export found for vault "${vaultName}" in ${root} (run \`export\` first)`);
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
    },

    clean: () => rm(root, { recursive: true, force: true }),
  };
}
