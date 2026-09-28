import type { Field, NormalizedItem, ResourcePlan, ResourceType } from './types.ts';

// Decides the Passbolt shape for one normalized item. Always exactly one
// resource per item:
// - a clear password and/or TOTP -> native type (browser autofill works);
// - otherwise -> v5-custom-fields holding everything;
// - fields left over after the native slots are attached to the same
//   resource as custom_fields (Passbolt v5 accepts custom_fields on any type).

export const TYPES = {
  DEFAULT: 'v5-default',
  DEFAULT_WITH_TOTP: 'v5-default-with-totp',
  TOTP_STANDALONE: 'v5-totp-standalone',
  CUSTOM_FIELDS: 'v5-custom-fields',
} as const satisfies Record<string, ResourceType>;

// DOCUMENT items are file attachments; `op item get` does not export the
// file content, so they always need a human decision.
const MANUAL_REVIEW_CATEGORIES = new Set(['DOCUMENT']);

export function needsManualReview(item: NormalizedItem): boolean {
  return !item.has_content || MANUAL_REVIEW_CATEGORIES.has(item.category);
}

function nativeType(hasPassword: boolean, hasTotp: boolean): ResourceType {
  if (hasTotp) return hasPassword ? TYPES.DEFAULT_WITH_TOTP : TYPES.TOTP_STANDALONE;
  return TYPES.DEFAULT;
}

export function planResource(item: NormalizedItem): ResourcePlan | null {
  if (needsManualReview(item)) return null;

  const passwordField = item.fields.find((f) => f.kind === 'password');
  if (!passwordField && !item.totp) {
    return {
      type: TYPES.CUSTOM_FIELDS,
      name: item.title,
      username: null,
      uri: item.uri,
      password: null,
      totp: null,
      customFields: item.fields,
    };
  }

  const type = nativeType(Boolean(passwordField), Boolean(item.totp));
  // v5-totp-standalone has no username slot: keep the username as a custom
  // field instead of silently dropping it.
  const usernameField = type === TYPES.TOTP_STANDALONE
    ? undefined
    : item.fields.find((f) => f.kind === 'username');

  return {
    type,
    name: item.title,
    username: usernameField?.value ?? null,
    uri: item.uri,
    password: passwordField?.value ?? null,
    totp: item.totp,
    customFields: item.fields.filter((f) => f !== passwordField && f !== usernameField),
  };
}

export interface CustomFields {
  metadata: Record<string, string>[];
  secret: Record<string, string>[];
}

/**
 * Builds the id-paired metadata/secret arrays of the v5 custom_fields schema.
 * Sensitive values live only on the encrypted secret side; the other side
 * still carries the key because the schema requires it on both arrays.
 */
export function toCustomFields(fields: Field[], newId: () => string): CustomFields {
  const metadata: CustomFields['metadata'] = [];
  const secret: CustomFields['secret'] = [];
  for (const field of fields) {
    const id = newId();
    if (field.kind === 'password') {
      metadata.push({ id, type: 'password', metadata_key: field.label });
      secret.push({ id, type: 'password', secret_value: field.value });
    } else {
      const type = field.kind === 'uri' ? 'uri' : 'text';
      metadata.push({ id, type, metadata_key: field.label, metadata_value: field.value });
      secret.push({ id, type, secret_value: '' });
    }
  }
  return { metadata, secret };
}

/** The native (name, username, uri) a resource created from `plan` exposes in listings. */
export function nativeIdentity(plan: ResourcePlan) {
  return { name: plan.name, username: plan.username ?? '', uri: plan.uri ?? '' };
}
