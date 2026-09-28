import { randomUUID } from 'node:crypto';
import { PartialResourceError, type PassboltPort } from '../app/ports.ts';
import { TYPES, toCustomFields, type CustomFields } from '../domain/resource-plan.ts';
import type { ResourcePlan } from '../domain/types.ts';
import { run, runJson } from './exec.ts';

// The default type is left to go-passbolt-cli (no --type), which picks the
// right password type for the server version.
export function createResourceArgs(plan: ResourcePlan, folderId: string): string[] {
  const args = ['create', 'resource'];
  if (plan.type !== TYPES.DEFAULT) args.push('--type', plan.type);
  args.push('--folderParentID', folderId, '--name', plan.name);
  if (plan.username) args.push('--username', plan.username);
  if (plan.uri) args.push('--uri', plan.uri);
  if (plan.password) args.push('--password', plan.password);
  if (plan.totp) args.push('--secret-field', `totp=${JSON.stringify(plan.totp)}`);
  return args;
}

export function customFieldArgs({ metadata, secret }: CustomFields): string[] {
  return [
    '--field', `custom_fields=${JSON.stringify(metadata)}`,
    '--secret-field', `custom_fields=${JSON.stringify(secret)}`,
  ];
}

/** Thin wrapper over go-passbolt-cli (`passbolt`). */
export function createPassbolt({ bin = 'passbolt', newId = randomUUID } = {}): PassboltPort {
  const attachCustomFields = async (id: string, plan: ResourcePlan) => {
    try {
      await run(bin, ['update', 'resource', '--id', id, ...customFieldArgs(toCustomFields(plan.customFields, newId))]);
    } catch (error) {
      throw new PartialResourceError(id, `resource ${id} created, but attaching ${plan.customFields.length} extra field(s) failed: ${(error as Error).message}`);
    }
  };

  return {
    listFolders: () => runJson(bin, ['list', 'folder', '--json']),

    createFolder: async (name) => (await runJson<{ id: string }>(bin, ['create', 'folder', '--name', name, '--json'])).id,

    listResources: (folderId) =>
      runJson(bin, ['list', 'resource', '--folder', folderId, '-c', 'id', '-c', 'name', '-c', 'username', '-c', 'uri', '--json']),

    getResource: (id) => runJson(bin, ['get', 'resource', '--id', id, '--json']),

    // Everything goes in at creation for custom-fields resources; native
    // ones get their leftover fields through a follow-up update.
    async createResource(plan, folderId) {
      const isCustom = plan.type === TYPES.CUSTOM_FIELDS;
      const args = createResourceArgs(plan, folderId);
      if (isCustom) args.push(...customFieldArgs(toCustomFields(plan.customFields, newId)));
      const { id } = await runJson<{ id: string }>(bin, [...args, '--json']);
      if (!isCustom && plan.customFields.length > 0) await attachCustomFields(id, plan);
      return id;
    },
  };
}
