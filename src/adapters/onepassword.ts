import type { OnePasswordPort } from '../app/ports.ts';
import { run, runJson } from './exec.ts';

/** Thin wrapper over the 1Password CLI (`op`). */
export function createOnePassword({ account, bin = 'op' }: { account?: string; bin?: string } = {}): OnePasswordPort {
  const accountArgs = account ? ['--account', account] : [];

  return {
    version: async () => (await run(bin, ['--version'])).trim(),
    listAccounts: () => runJson(bin, ['account', 'list', '--format=json']),
    listVaults: () => runJson(bin, ['vault', 'list', ...accountArgs, '--format=json']),
    listItems: (vaultId) => runJson(bin, ['item', 'list', '--vault', vaultId, ...accountArgs, '--format=json']),
    getItem: (itemId) => runJson(bin, ['item', 'get', itemId, ...accountArgs, '--format=json']),
  };
}
