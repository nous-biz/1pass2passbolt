import { normalizeItem } from '../domain/normalize.ts';
import { planResource, TYPES } from '../domain/resource-plan.ts';
import type { Field, ResourcePlan } from '../domain/types.ts';
import type { Deps, PassboltResource } from './ports.ts';

// Field-by-field fidelity check: a count alone passes even when a field was
// imported empty or a TOTP seed is wrong. Reports labels only, never values.

function customFieldValue(resource: PassboltResource, index: number, field: Field): string | undefined {
  if (field.kind === 'password') return resource.secret?.custom_fields?.[index]?.secret_value;
  return resource.metadata?.custom_fields?.[index]?.metadata_value;
}

/** @returns labels of the fields that differ */
export function compareResource(plan: ResourcePlan, resource: PassboltResource): string[] {
  const mismatches: string[] = [];
  const check = (label: string, expected: string | null | undefined, actual: string | null | undefined) => {
    if ((expected ?? '') !== (actual ?? '')) mismatches.push(label);
  };

  check('name', plan.name, resource.name);
  check('uri', plan.uri, resource.uri);
  if (plan.type !== TYPES.CUSTOM_FIELDS) check('username', plan.username, resource.username);
  if (plan.password) check('password', plan.password, resource.password ?? resource.secret?.password);
  if (plan.totp) check('totp', plan.totp.secret_key, resource.secret?.totp?.secret_key);
  plan.customFields.forEach((field, index) => check(field.label, field.value, customFieldValue(resource, index, field)));
  return mismatches;
}

function sample<T>(list: T[], size: number): T[] {
  const shuffled = [...list];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
  }
  return shuffled.slice(0, size);
}

/** Checks a random sample (size = Infinity checks all) of the vault's ledger entries. */
export async function verifyMigration(
  { passbolt, state, log }: Deps,
  { vault, size }: { vault: string; size: number },
): Promise<{ checked: number; failures: number }> {
  const ledger = await state.readLedger();
  const migrated = (await state.readVaultItems(vault)).map(normalizeItem).filter((item) => ledger.has(item.op_id));
  const picked = sample(migrated, size);

  let failures = 0;
  for (const item of picked) {
    const plan = planResource(item);
    const resourceId = ledger.get(item.op_id);
    if (!plan || !resourceId) continue;
    const mismatches = compareResource(plan, await passbolt.getResource(resourceId));
    if (mismatches.length > 0) failures += 1;
    log.info(mismatches.length === 0 ? `OK        ${item.title}` : `MISMATCH  ${item.title}: ${mismatches.join(', ')}`);
  }
  return { checked: picked.length, failures };
}
