import type { OpItem } from '../domain/types.ts';
import type { Deps } from './ports.ts';
import { resolveVaults } from './vaults.ts';

/** Exports full item JSON (secrets in plaintext) of the selected vaults into the state dir. */
export async function exportVaults(
  { onePassword, state, log }: Deps,
  { vaults, all, account }: { vaults: string[]; all: boolean; account?: string },
): Promise<void> {
  for (const vault of await resolveVaults(onePassword, { names: vaults, all, account })) {
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
