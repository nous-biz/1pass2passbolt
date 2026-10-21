import { describeAccounts } from './accounts.ts';
import type { OnePasswordPort } from './ports.ts';

export type Vault = { id: string; name: string };

function describeVaults(vaults: Vault[]): string {
  if (vaults.length === 0) return 'this account has no readable vaults';
  return `available vaults:\n${vaults.map((v) => `  - ${v.name}`).join('\n')}`;
}

function selectVaults(allVaults: Vault[], names: string[], all: boolean): Vault[] {
  if (all) {
    if (allVaults.length === 0) throw new Error(describeVaults(allVaults));
    return allVaults;
  }
  if (names.length === 0) throw new Error('pass --vault <name> (repeatable) or --all-vaults');
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

/** Resolves the vaults a command acts on: the named ones, or every vault of the account. */
export async function resolveVaults(
  onePassword: OnePasswordPort,
  { names, all, account }: { names: string[]; all: boolean; account?: string },
): Promise<Vault[]> {
  return selectVaults(await listVaults(onePassword, account), names, all);
}
