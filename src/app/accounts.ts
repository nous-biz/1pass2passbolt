import type { OnePasswordPort } from './ports.ts';

type Account = Awaited<ReturnType<OnePasswordPort['listAccounts']>>[number];

/** Lists the signed-in accounts so a mistyped --account can be corrected. */
export function describeAccounts(accounts: Account[]): string {
  if (accounts.length === 0) return 'no 1Password account is signed in; run `op account add`';
  const lines = accounts.map((a) => `  - ${a.url} (${a.email})`);
  return `available accounts:\n${lines.join('\n')}\npass --account <sign-in address or email>`;
}
