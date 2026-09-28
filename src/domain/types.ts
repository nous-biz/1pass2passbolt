/** A field as it comes from `op item get --format=json` (only what we read). */
export interface OpField {
  type?: string;
  purpose?: string;
  label?: string;
  value?: unknown;
}

/** An item as it comes from `op item get --format=json` (only what we read). */
export interface OpItem {
  id: string;
  title: string;
  category: string;
  vault?: { name?: string };
  fields?: OpField[];
  urls?: { href: string; primary?: boolean }[];
}

export type FieldKind = 'username' | 'password' | 'text' | 'uri';

export interface Field {
  label: string;
  value: string;
  kind: FieldKind;
}

export interface Totp {
  secret_key: string;
  algorithm: string;
  digits: number;
  period: number;
}

export interface NormalizedItem {
  vault: string | null;
  op_id: string;
  title: string;
  category: string;
  uri: string | null;
  totp: Totp | null;
  fields: Field[];
  has_content: boolean;
}

export type ResourceType =
  | 'v5-default'
  | 'v5-default-with-totp'
  | 'v5-totp-standalone'
  | 'v5-custom-fields';

export interface ResourcePlan {
  type: ResourceType;
  name: string;
  username: string | null;
  uri: string | null;
  password: string | null;
  totp: Totp | null;
  /** Fields that don't fit a native slot, stored as custom_fields on the same resource. */
  customFields: Field[];
}

/** A resource as listed by `passbolt list resource -c id -c name -c username -c uri`. */
export interface ExistingResource {
  id: string;
  name: string;
  username?: string;
  uri?: string;
}

/** op_id -> Passbolt resource id */
export type Ledger = Map<string, string>;
