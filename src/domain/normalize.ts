import type { Field, FieldKind, NormalizedItem, OpField, OpItem, Totp } from './types.ts';

// Turns a raw `op item get --format=json` item into a flat, Passbolt-ready
// shape. Every field is kept with its original label and tagged with a
// `kind`; nothing is folded into free text. Deciding the final resource
// shape is the job of resource-plan.ts.

const OTHER_TEXT_TYPES = new Set([
  'ADDRESS', 'EMAIL', 'PHONE', 'DATE', 'MENU', 'MONTH_YEAR', 'CREDIT_CARD_TYPE',
]);

interface FieldRule {
  match: (f: OpField) => boolean;
  kind: FieldKind;
  /** Fallback label; the op label wins unless `forceLabel` is set. */
  label?: string;
  forceLabel?: boolean;
}

// Order matters: resource-plan.ts consumes the *first* username/password,
// and verify compares custom fields by position.
const FIELD_RULES: FieldRule[] = [
  { match: (f) => f.purpose === 'USERNAME', kind: 'username', label: 'username' },
  { match: (f) => f.purpose === 'PASSWORD', kind: 'password', label: 'password' },
  { match: (f) => f.type === 'CONCEALED' && f.purpose !== 'PASSWORD', kind: 'password', label: 'secret' },
  { match: (f) => f.type === 'SSHKEY', kind: 'password', label: 'private key' },
  { match: (f) => f.type === 'CREDIT_CARD_NUMBER', kind: 'password', label: 'card number' },
  { match: (f) => f.purpose === 'NOTES', kind: 'text', label: 'notes', forceLabel: true },
  { match: (f) => f.type === 'STRING' && !f.purpose && f.label !== 'notesPlain', kind: 'text', label: 'field' },
  { match: (f) => f.type === 'URL', kind: 'uri', label: 'url' },
  { match: (f) => OTHER_TEXT_TYPES.has(f.type ?? ''), kind: 'text' },
];

const hasValue = (f: OpField) => f.value !== undefined && f.value !== null && f.value !== '';

// Passbolt custom field values are strings; some op field types can carry
// structured values.
const asString = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

function labelFor(rule: FieldRule, f: OpField): string {
  if (rule.forceLabel && rule.label) return rule.label;
  return f.label ?? rule.label ?? f.type ?? 'field';
}

function extractFields(rawFields: OpField[]): Field[] {
  const withValue = rawFields.filter(hasValue);
  return FIELD_RULES.flatMap((rule) =>
    withValue.filter(rule.match).map((f) => ({ label: labelFor(rule, f), value: asString(f.value), kind: rule.kind })),
  );
}

const cleanBase32 = (s: string) => s.replace(/[ -]/g, '').toUpperCase();

function queryParam(uri: string, name: string): string | null {
  return uri.match(new RegExp(`${name}=([^&]+)`, 'i'))?.[1] ?? null;
}

/** Accepts both formats found in real exports: a bare base32 seed or an otpauth:// URI. */
export function parseTotp(raw: string | null | undefined): Totp | null {
  if (!raw) return null;
  if (!raw.startsWith('otpauth:')) {
    return { secret_key: cleanBase32(raw), algorithm: 'SHA1', digits: 6, period: 30 };
  }
  return {
    secret_key: cleanBase32(queryParam(raw, 'secret') ?? ''),
    algorithm: (queryParam(raw, 'algorithm') ?? 'SHA1').toUpperCase(),
    digits: Number(queryParam(raw, 'digits') ?? 6),
    period: Number(queryParam(raw, 'period') ?? 30),
  };
}

function primaryUri(urls: OpItem['urls'] = []): string | null {
  return (urls.find((u) => u.primary === true) ?? urls[0])?.href ?? null;
}

export function normalizeItem(item: OpItem): NormalizedItem {
  const rawFields = item.fields ?? [];
  const otp = rawFields.find((f) => f.type === 'OTP' && hasValue(f));
  const totp = parseTotp(otp ? asString(otp.value) : null);
  const uri = primaryUri(item.urls);
  const fields = extractFields(rawFields);

  return {
    vault: item.vault?.name ?? null,
    op_id: item.id,
    title: item.title,
    category: item.category,
    uri,
    totp,
    fields,
    has_content: fields.length > 0 || totp !== null || uri !== null,
  };
}
