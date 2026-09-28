import type { OpItem } from '../domain/types.ts';
import type { Deps } from './ports.ts';

type Vault = { id: string; name: string };

function selectVaults(allVaults: Vault[], names: string[], all: boolean): Vault[] {
  if (all) return allVaults;
  if (names.length === 0) throw new Error('pass --vault <name> (repeatable) or --all');
  return names.map((name) => {
    const vault = allVaults.find((v) => v.name === name);
    if (!vault) throw new Error(`vault "${name}" not found in this 1Password account`);
    return vault;
  });
}

/** Exports full item JSON (secrets in plaintext) of the selected vaults into the state dir. */
export async function exportVaults(
  { onePassword, state, log }: Deps,
  { vaults, all }: { vaults: string[]; all: boolean },
): Promise<void> {
  for (const vault of selectVaults(await onePassword.listVaults(), vaults, all)) {
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
