import type { ExistingResource, Ledger, OpItem, ResourcePlan } from '../domain/types.ts';

// Contracts the use cases depend on; adapters/ implements them.

export interface OnePasswordPort {
  version(): Promise<string>;
  listAccounts(): Promise<{ url: string; email: string }[]>;
  listVaults(): Promise<{ id: string; name: string }[]>;
  listItems(vaultId: string): Promise<{ id: string }[]>;
  getItem(itemId: string): Promise<OpItem>;
}

/** A resource as returned by `passbolt get resource --json` (only what we read). */
export interface PassboltResource {
  name?: string;
  username?: string;
  uri?: string;
  password?: string;
  metadata?: { custom_fields?: { type?: string; metadata_key?: string; metadata_value?: string }[] };
  secret?: {
    password?: string;
    totp?: { secret_key?: string; algorithm?: string; digits?: number; period?: number };
    custom_fields?: { secret_value?: string }[];
  };
}

export interface PassboltPort {
  listFolders(): Promise<{ id: string; name: string }[]>;
  createFolder(name: string): Promise<string>;
  listResources(folderId: string): Promise<ExistingResource[]>;
  getResource(id: string): Promise<PassboltResource>;
  /** Creates one resource; throws PartialResourceError if extra fields couldn't be attached. */
  createResource(plan: ResourcePlan, folderId: string): Promise<string>;
}

export type LedgerStatus = 'created' | 'partial' | 'matched';

export interface StatePort {
  readonly root: string;
  writeVaultItems(vaultName: string, items: OpItem[]): Promise<string>;
  readVaultItems(vaultName: string): Promise<OpItem[]>;
  readLedger(): Promise<Ledger>;
  appendLedger(entry: { opId: string; vault: string; name: string; resourceId: string; status: LedgerStatus }): Promise<void>;
  clean(): Promise<void>;
}

export interface Logger {
  info(message: string): void;
  error(message: string): void;
  progress(message: string): void;
}

export interface Deps {
  onePassword: OnePasswordPort;
  passbolt: PassboltPort;
  state: StatePort;
  log: Logger;
}

/** The resource exists but some of its fields are missing; a human must finish it. */
export class PartialResourceError extends Error {
  readonly resourceId: string;

  constructor(resourceId: string, message: string) {
    super(message);
    this.name = 'PartialResourceError';
    this.resourceId = resourceId;
  }
}
