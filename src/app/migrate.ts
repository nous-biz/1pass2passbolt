import { BUCKETS, buildMigrationPlan, summarize, type Bucket, type PlanEntry } from '../domain/migration-plan.ts';
import { normalizeItem } from '../domain/normalize.ts';
import type { Ledger, NormalizedItem, ResourcePlan } from '../domain/types.ts';
import { resolveFolder, type FolderSelector, type TargetFolder } from './folder.ts';
import { PartialResourceError, type Deps } from './ports.ts';

export interface MigrationPlan {
  folder: TargetFolder;
  entries: PlanEntry[];
  counts: Record<Bucket, number>;
  ledger: Ledger;
}

/** Read-only: compares one exported vault with the target folder. */
export async function planMigration(
  { passbolt, state }: Deps,
  { vault, ...selector }: { vault: string } & FolderSelector,
): Promise<MigrationPlan> {
  const items = (await state.readVaultItems(vault)).map(normalizeItem);
  const folder = await resolveFolder(passbolt, selector);
  const existing = folder.id ? await passbolt.listResources(folder.id) : [];
  const ledger = await state.readLedger();
  const entries = buildMigrationPlan(items, existing, ledger);
  return { folder, entries, counts: summarize(entries), ledger };
}

async function recordMatches({ state }: Deps, vault: string, { entries, ledger }: MigrationPlan): Promise<number> {
  let recorded = 0;
  for (const entry of entries) {
    if (entry.bucket !== BUCKETS.PRESENT || !entry.resourceId) continue;
    if (ledger.get(entry.item.op_id) === entry.resourceId) continue;
    await state.appendLedger({ opId: entry.item.op_id, vault, name: entry.item.title, resourceId: entry.resourceId, status: 'matched' });
    recorded += 1;
  }
  return recorded;
}

async function createOne(
  { passbolt, state, log }: Deps,
  vault: string,
  folderId: string,
  { item, plan }: { item: NormalizedItem; plan: ResourcePlan },
): Promise<boolean> {
  const record = (resourceId: string, status: 'created' | 'partial') =>
    state.appendLedger({ opId: item.op_id, vault, name: item.title, resourceId, status });
  try {
    await record(await passbolt.createResource(plan, folderId), 'created');
    log.info(`created: ${item.title}`);
    return true;
  } catch (error) {
    // A resource that exists but lacks its extra fields is still recorded,
    // so a rerun doesn't duplicate it; it needs a manual fix instead.
    if (error instanceof PartialResourceError) await record(error.resourceId, 'partial');
    log.error(`failed: ${item.title}: ${(error as Error).message}`);
    return false;
  }
}

export interface ImportResult {
  counts: Record<Bucket, number>;
  created: number;
  failed: number;
}

/** Creates every item of the `create` bucket, after recording known matches in the ledger. */
export async function runImport(
  deps: Deps,
  options: { vault: string; confirm: (question: string) => Promise<boolean> } & FolderSelector,
): Promise<ImportResult> {
  const { passbolt, log } = deps;
  const { vault, confirm, ...selector } = options;
  const migrationPlan = await planMigration(deps, { vault, ...selector });
  const { folder, entries, counts } = migrationPlan;
  const nothingDone = { counts, created: 0, failed: 0 };

  const recorded = await recordMatches(deps, vault, migrationPlan);
  if (recorded > 0) log.info(`recorded ${recorded} already-present resource(s) in the ledger`);

  const toCreate = entries.flatMap((e) => (e.bucket === BUCKETS.CREATE ? [e] : []));
  if (toCreate.length === 0) {
    log.info('nothing to create');
    return nothingDone;
  }
  const target = folder.id ? `"${folder.name}"` : `new folder "${folder.name}"`;
  if (!(await confirm(`Create ${toCreate.length} resource(s) in ${target}?`))) {
    log.info('aborted, nothing written to Passbolt');
    return nothingDone;
  }

  let folderId = folder.id;
  if (!folderId) {
    folderId = await passbolt.createFolder(folder.name);
    log.info(`created folder "${folder.name}"`);
  }

  let created = 0;
  for (const entry of toCreate) {
    if (await createOne(deps, vault, folderId, entry)) created += 1;
  }
  return { counts, created, failed: toCreate.length - created };
}
