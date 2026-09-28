import { normalizeItem } from '../domain/normalize.ts';
import { planResource, TYPES } from '../domain/resource-plan.ts';
import type { Field, ResourcePlan } from '../domain/types.ts';
import type { Deps, PassboltResource } from './ports.ts';

// Field-by-field fidelity check: a count alone passes even when a field was
// imported empty or a TOTP seed is wrong.

const customFieldType = (field: Field) => (field.kind === 'password' ? 'password' : field.kind === 'uri' ? 'uri' : 'text');

function customFieldValue(resource: PassboltResource, index: number, field: Field): string | undefined {
  if (field.kind === 'password') return resource.secret?.custom_fields?.[index]?.secret_value;
  return resource.metadata?.custom_fields?.[index]?.metadata_value;
}

export interface Comparison {
  /** Fields whose value or type differs: the migration lost data. */
  mismatches: string[];
  /** Custom fields stored under another label: cosmetic, e.g. renamed by hand. */
  relabeled: string[];
}

/** Reports field labels only, never values. Labels and types are metadata, not secrets. */
export function compareResource(plan: ResourcePlan, resource: PassboltResource): Comparison {
  const mismatches: string[] = [];
  const relabeled: string[] = [];
  const check = (label: string, expected: string | null | undefined, actual: string | null | undefined) => {
    if ((expected ?? '') !== (actual ?? '')) mismatches.push(label);
  };

  check('name', plan.name, resource.name);
  check('uri', plan.uri, resource.uri);
  if (plan.type !== TYPES.CUSTOM_FIELDS) check('username', plan.username, resource.username);
  if (plan.password) check('password', plan.password, resource.password ?? resource.secret?.password);
  if (plan.totp) {
    const stored = resource.secret?.totp;
    check('totp secret', plan.totp.secret_key, stored?.secret_key);
    check('totp algorithm', plan.totp.algorithm, stored?.algorithm);
    check('totp digits', String(plan.totp.digits), stored?.digits === undefined ? undefined : String(stored.digits));
    check('totp period', String(plan.totp.period), stored?.period === undefined ? undefined : String(stored.period));
  }
  plan.customFields.forEach((field, index) => {
    check(field.label, field.value, customFieldValue(resource, index, field));
    const stored = resource.metadata?.custom_fields?.[index];
    if (stored?.type !== customFieldType(field)) mismatches.push(`${field.label} (type ${stored?.type ?? 'missing'}, expected ${customFieldType(field)})`);
    if (stored?.metadata_key !== field.label) relabeled.push(`"${field.label}" stored as "${stored?.metadata_key ?? ''}"`);
  });
  return { mismatches, relabeled };
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
): Promise<{ checked: number; failures: number; relabeled: number }> {
  const ledger = await state.readLedger();
  const migrated = (await state.readVaultItems(vault)).map(normalizeItem).filter((item) => ledger.has(item.op_id));
  const picked = sample(migrated, size);

  let failures = 0;
  let relabeledCount = 0;
  for (const item of picked) {
    const plan = planResource(item);
    const resourceId = ledger.get(item.op_id);
    if (!plan || !resourceId) continue;
    const { mismatches, relabeled } = compareResource(plan, await passbolt.getResource(resourceId));
    if (mismatches.length > 0) {
      failures += 1;
      log.info(`MISMATCH  ${item.title}: ${mismatches.join(', ')}`);
    } else if (relabeled.length > 0) {
      relabeledCount += 1;
      log.info(`LABELS    ${item.title}: ${[...new Set(relabeled)].join(', ')}`);
    } else {
      log.info(`OK        ${item.title}`);
    }
  }
  return { checked: picked.length, failures, relabeled: relabeledCount };
}
