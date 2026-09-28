import { nativeIdentity, planResource } from './resource-plan.ts';
import type { ExistingResource, Ledger, NormalizedItem, ResourcePlan } from './types.ts';

// Passbolt has no natural key to dedupe against, so an item counts as
// already migrated when the ledger says so, or when the items and the
// existing resources sharing its (name, username, uri) come in equal
// numbers. More items than resources for that tuple is ambiguous: we can't
// tell which one is missing, so nothing is created automatically.

export const BUCKETS = {
  CREATE: 'create',
  PRESENT: 'present',
  AMBIGUOUS: 'ambiguous',
  MANUAL: 'manual',
} as const;

export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

export type PlanEntry =
  | { item: NormalizedItem; bucket: typeof BUCKETS.MANUAL; plan: null }
  | {
    item: NormalizedItem;
    bucket: Exclude<Bucket, typeof BUCKETS.MANUAL>;
    plan: ResourcePlan;
    /** Set only when the matching resource is known one-to-one. */
    resourceId?: string;
  };

type Identity = { name: string; username?: string; uri?: string };

const identityKey = ({ name, username, uri }: Identity) => JSON.stringify([name, username ?? '', uri ?? '']);

function groupBy<T>(list: T[], keyOf: (entry: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of list) {
    const key = keyOf(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return groups;
}

function matchBucket(items: number, resources: number): Exclude<Bucket, typeof BUCKETS.MANUAL> {
  if (resources === 0) return BUCKETS.CREATE;
  return items <= resources ? BUCKETS.PRESENT : BUCKETS.AMBIGUOUS;
}

export function buildMigrationPlan(
  items: NormalizedItem[],
  existing: ExistingResource[],
  ledger: Ledger,
): PlanEntry[] {
  const existingIds = new Set(existing.map((r) => r.id));
  const result: PlanEntry[] = [];
  const candidates: { item: NormalizedItem; plan: ResourcePlan }[] = [];

  for (const item of items) {
    const plan = planResource(item);
    const recordedId = ledger.get(item.op_id);
    if (!plan) {
      result.push({ item, bucket: BUCKETS.MANUAL, plan: null });
    } else if (recordedId && existingIds.has(recordedId)) {
      result.push({ item, bucket: BUCKETS.PRESENT, plan, resourceId: recordedId });
    } else {
      candidates.push({ item, plan });
    }
  }

  const claimed = new Set(ledger.values());
  const resourcesByKey = groupBy(existing.filter((r) => !claimed.has(r.id)), identityKey);
  const candidatesByKey = groupBy(candidates, (c) => identityKey(nativeIdentity(c.plan)));

  for (const [key, group] of candidatesByKey) {
    const matches = resourcesByKey.get(key) ?? [];
    const bucket = matchBucket(group.length, matches.length);
    const onlyMatch = group.length === 1 && matches.length === 1 ? matches[0] : undefined;
    for (const { item, plan } of group) {
      result.push({ item, bucket, plan, ...(onlyMatch ? { resourceId: onlyMatch.id } : {}) });
    }
  }

  return result;
}

export function summarize(entries: PlanEntry[]): Record<Bucket, number> {
  const counts = { create: 0, present: 0, ambiguous: 0, manual: 0 };
  for (const { bucket } of entries) counts[bucket] += 1;
  return counts;
}
