import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Deps } from './ports.ts';

const DEFAULT_PASSBOLT_CONFIG = join(homedir(), '.config', 'go-passbolt-cli', 'go-passbolt-cli.toml');

export interface Check {
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

async function passboltMfaMode(configPath: string): Promise<string | null> {
  try {
    return (await readFile(configPath, 'utf8')).match(/^\s*mfamode\s*=\s*['"]([^'"]+)['"]/im)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function runDoctor(
  { onePassword, passbolt }: Pick<Deps, 'onePassword' | 'passbolt'>,
  { account, passboltConfig = DEFAULT_PASSBOLT_CONFIG }: { account?: string; passboltConfig?: string },
): Promise<Check[]> {
  const checks: Check[] = [];
  const attempt = async (label: string, fn: () => Promise<string>) => {
    try {
      checks.push({ status: 'ok', message: `${label}: ${await fn()}` });
    } catch (error) {
      checks.push({ status: 'fail', message: `${label}: ${(error as Error).message}` });
    }
  };

  await attempt('op', () => onePassword.version());
  await attempt('op account', async () => {
    const accounts = await onePassword.listAccounts();
    if (account && !accounts.some((a) => a.url === account || a.email === account)) {
      throw new Error(`"${account}" is not signed in (op account add / op signin)`);
    }
    return `${accounts.length} account(s) available`;
  });
  await attempt('op vaults', async () => `${(await onePassword.listVaults()).length} vault(s) readable`);
  await attempt('passbolt', async () => `${(await passbolt.listFolders()).length} folder(s) readable`);

  // go-passbolt-cli defaults to interactive-totp, which blocks a batch run
  // on a prompt for every call.
  const mfaMode = await passboltMfaMode(passboltConfig);
  checks.push(mfaMode === null || mfaMode === 'interactive-totp'
    ? { status: 'warn', message: `passbolt mfaMode is ${mfaMode ?? 'unset (interactive-totp)'}; batch imports will block on prompts. Configure "none" or "noninteractive-totp".` }
    : { status: 'ok', message: `passbolt mfaMode: ${mfaMode}` });
  return checks;
}
