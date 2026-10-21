import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { Command, InvalidArgumentError } from 'commander';
import { createOnePassword } from './adapters/onepassword.ts';
import { createPassbolt } from './adapters/passbolt.ts';
import { createStateStore } from './adapters/state.ts';
import { runDoctor } from './app/doctor.ts';
import { exportVaults } from './app/export.ts';
import { planMigration, runImport, type MigrationPlan } from './app/migrate.ts';
import type { Deps, Logger } from './app/ports.ts';
import { resolveVaults } from './app/vaults.ts';
import { verifyMigration } from './app/verify.ts';
import { BUCKETS } from './domain/migration-plan.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const clearProgress = () => {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
};

const log: Logger = {
  info: (message) => {
    clearProgress();
    console.log(message);
  },
  error: (message) => {
    clearProgress();
    console.error(message);
  },
  progress: (message) => {
    if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${message}`);
  },
};

async function confirmOnTty(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error('not a TTY: pass --yes to confirm writes non-interactively');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}

const collect = (value: string, previous: string[]) => [...previous, value];

interface GlobalOptions {
  stateDir: string;
  account?: string;
}

interface CommandOptions extends GlobalOptions {
  vault: string[];
  allVaults?: boolean;
  folder?: string;
  folderId?: string;
  verbose?: boolean;
  yes?: boolean;
  sample?: number;
  all?: boolean;
}

function dependencies(opts: GlobalOptions): Deps {
  return {
    onePassword: createOnePassword({ account: opts.account }),
    passbolt: createPassbolt(),
    state: createStateStore(opts.stateDir, opts.account),
    log,
  };
}

const folderSelector = (opts: CommandOptions, vault: string) => ({ folderName: opts.folder ?? vault, folderId: opts.folderId });

function printPlan({ folder, entries, counts }: MigrationPlan, verbose = false) {
  log.info(`target folder: "${folder.name}"${folder.id ? '' : ' (will be created)'}`);
  log.info(`  to create:      ${counts.create}`);
  log.info(`  already there:  ${counts.present}`);
  log.info(`  ambiguous:      ${counts.ambiguous}  (more items than resources share a name/username/uri; resolve by hand)`);
  log.info(`  manual review:  ${counts.manual}  (DOCUMENT attachments or empty items)`);

  const listed = verbose ? Object.values(BUCKETS) : [BUCKETS.AMBIGUOUS, BUCKETS.MANUAL];
  for (const bucket of listed) {
    const titles = entries.filter((e) => e.bucket === bucket).map((e) => `  - ${e.item.title}`);
    if (titles.length > 0) log.info(`\n${bucket}:\n${titles.join('\n')}`);
  }
}

function withVaultOptions(cmd: Command): Command {
  return cmd
    .option('-v, --vault <name>', '1Password vault name (exact, repeatable)', collect, [])
    .option('--all-vaults', 'every vault of the account');
}

function withFolderOptions(cmd: Command): Command {
  return withVaultOptions(cmd)
    .option('-f, --folder <name>', 'target Passbolt folder name (exact; defaults to the vault name)')
    .option('--folder-id <id>', 'target Passbolt folder id (overrides --folder)');
}

// A failing vault doesn't stop the others: the ledger makes a rerun resume where it left off.
async function forEachVault(deps: Deps, opts: CommandOptions, run: (vault: string) => Promise<void>) {
  const vaults = await resolveVaults(deps.onePassword, { names: opts.vault, all: Boolean(opts.allVaults), account: opts.account });
  if (vaults.length > 1 && (opts.folder || opts.folderId)) {
    throw new Error('--folder and --folder-id name a single folder: use them with one vault, or omit them to get one folder per vault');
  }
  for (const { name } of vaults) {
    if (vaults.length > 1) log.info(`\n== vault "${name}" ==`);
    try {
      await run(name);
    } catch (error) {
      log.error(`error: ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
}

const action = <T extends GlobalOptions = CommandOptions>(fn: (deps: Deps, opts: T) => Promise<void>) => async (...args: unknown[]) => {
  const opts = (args.at(-1) as Command).optsWithGlobals<T>();
  await fn(dependencies(opts), opts);
};

export function buildProgram(): Command {
  const program = new Command()
    .name('1pass2passbolt')
    .description('Migrate 1Password vaults into Passbolt folders: one item -> one resource, labels preserved.')
    .version(version)
    .option('-s, --state-dir <dir>', 'local dir for exports and the ledger (holds plaintext secrets)', '.1pass2passbolt')
    .option('-a, --account <account>', '1Password account sign-in address (e.g. example.1password.com)');

  program.command('doctor')
    .description('check that op and passbolt are installed, signed in, and non-interactive')
    .action(action(async (deps, opts) => {
      const checks = await runDoctor(deps, { account: opts.account });
      for (const { status, message } of checks) log.info(`${status.toUpperCase().padEnd(4)}  ${message}`);
      if (checks.some((c) => c.status === 'fail')) process.exitCode = 1;
    }));

  withVaultOptions(program.command('export'))
    .description('export full item JSON of vault(s) into the state dir (plaintext secrets, mode 0600)')
    .option('--all', 'alias of --all-vaults')
    .action(action(async (deps, opts) => {
      await exportVaults(deps, { vaults: opts.vault, all: Boolean(opts.allVaults || opts.all), account: opts.account });
    }));

  withFolderOptions(program.command('plan'))
    .description('dry run: show what import would create, skip, or leave for manual review')
    .option('--verbose', 'list the item titles of every bucket')
    .action(action((deps, opts) => forEachVault(deps, opts, async (vault) => {
      printPlan(await planMigration(deps, { vault, ...folderSelector(opts, vault) }), opts.verbose);
    })));

  withFolderOptions(program.command('import'))
    .description('create the missing resources in Passbolt (resumable, never duplicates a ledger entry)')
    .option('-y, --yes', 'do not ask for confirmation')
    .action(action((deps, opts) => forEachVault(deps, opts, async (vault) => {
      const confirm = opts.yes ? async () => true : confirmOnTty;
      const result = await runImport(deps, { vault, ...folderSelector(opts, vault), confirm });
      log.info(`created ${result.created}, failed ${result.failed}; ambiguous ${result.counts.ambiguous}, manual review ${result.counts.manual}`);
      if (result.failed > 0) process.exitCode = 1;
    })));

  withVaultOptions(program.command('verify'))
    .description('compare migrated resources with the export, field by field')
    .option('-n, --sample <size>', 'number of random items to check per vault (default 15)', positiveInt)
    .option('--all', 'check every migrated item')
    .action(action((deps, opts) => forEachVault(deps, opts, async (vault) => {
      const size = opts.all ? Infinity : (opts.sample ?? 15);
      const { checked, failures, relabeled } = await verifyMigration(deps, { vault, size });
      log.info(`\nchecked ${checked}, mismatches ${failures}, label-only differences ${relabeled}`);
      if (failures > 0) process.exitCode = 1;
    })));

  program.command('clean')
    .description('delete the state dir (exports and ledger)')
    .action(action(async (deps) => {
      await deps.state.clean();
      log.info(`removed ${deps.state.root}`);
    }));

  return program;
}

export async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    log.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
