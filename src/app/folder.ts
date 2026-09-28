import type { PassboltPort } from './ports.ts';

export interface TargetFolder {
  /** null when the folder doesn't exist yet */
  id: string | null;
  name: string;
}

export interface FolderSelector {
  folderName: string;
  folderId?: string;
}

/**
 * Resolves the target folder by exact name. Never guesses: several exact
 * matches, or only a case-insensitive near match, are errors, so a run
 * can't land in the wrong folder or create a look-alike one.
 */
export async function resolveFolder(passbolt: PassboltPort, { folderName, folderId }: FolderSelector): Promise<TargetFolder> {
  if (folderId) return { id: folderId, name: folderName };

  const folders = await passbolt.listFolders();
  const exact = folders.filter((f) => f.name === folderName);
  if (exact.length > 1) {
    throw new Error(`${exact.length} folders are named "${folderName}"; pick one with --folder-id (${exact.map((f) => f.id).join(', ')})`);
  }
  if (exact[0]) return { id: exact[0].id, name: folderName };

  const near = folders.filter((f) => f.name.toLowerCase() === folderName.toLowerCase());
  if (near.length > 0) {
    throw new Error(`no folder named exactly "${folderName}", but found ${near.map((f) => `"${f.name}"`).join(', ')}; pass the exact name or --folder-id`);
  }
  return { id: null, name: folderName };
}
