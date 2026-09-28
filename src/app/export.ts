import type { OpItem } from '../domain/types.ts';
import { describeAccounts } from './accounts.ts';
import type { Deps, OnePasswordPort } from './ports.ts';

type Vault = { id: string; name: string };

function describeVaults(vaults: Vault[]): string {
  if (vaults.length === 0) return 'this account has no readable vaults';
  return `available vaults:\n${vaults.map((v) => `  - ${v.name}`).join('\n')}`;
}

function selectVaults(allVaults: Vault[], names: string[], all: boolean): Vault[] {
  if (all) return allVaults;
  if (names.length === 0) throw new Error('pass --vault <name> (repeatable) or --all');
  const missing = names.filter((name) => !allVaults.some((v) => v.name === name));
  if (missing.length > 0) {
    const quoted = missing.map((name) => `"${name}"`).join(', ');
    throw new Error(`vault(s) ${quoted} not found in this 1Password account\n${describeVaults(allVaults)}`);
  }
  return names.map((name) => allVaults.find((v) => v.name === name)!);
}

// `op` accepts shorthands and ids we can't validate up front, so the account
// list is only offered once `op` has rejected the call.
async function listVaults(onePassword: OnePasswordPort, account?: string): Promise<Vault[]> {
  try {
    return await onePassword.listVaults();
  } catch (error) {
    if (!account) throw error;
    const accounts = await onePassword.listAccounts().catch(() => null);
    if (!accounts) throw error;
    throw new Error(`${(error as Error).message}\n${describeAccounts(accounts)}`, { cause: error });
  }
}

/** Exports full item JSON (secrets in plaintext) of the selected vaults into the state dir. */
export async function exportVaults(
  { onePassword, state, log }: Deps,
  { vaults, all, account }: { vaults: string[]; all: boolean; account?: string },
): Promise<void> {
  for (const vault of selectVaults(await listVaults(onePassword, account), vaults, all)) {
    const summaries = await onePassword.listItems(vault.id);
    const items: OpItem[] = [];
    for (const [index, summary] of summaries.entries()) {
      log.progress(`vault "${vault.name}": ${index + 1}/${summaries.length}`);
      items.push(await onePassword.getItem(summary.id));
    }
    const path = await state.writeVaultItems(vault.name, items);
    log.info(`vault "${vault.name}": ${items.length} item(s) -> ${path}`);
  }
}
