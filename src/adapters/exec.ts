import { execFile } from 'node:child_process';

/**
 * Runs a binary with an argv array (never through a shell, so secrets are
 * never parsed by one). Errors name only the binary and subcommand, never
 * the full argv, which may contain secrets.
 */
export function run(binary: string, args: string[]): Promise<string> {
  const label = `${binary} ${args.slice(0, 2).join(' ')}`;
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const reason = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `${binary} not found in PATH`
        : stderr.trim() || 'no error output';
      reject(new Error(`${label} failed: ${reason}`));
    });
  });
}

export async function runJson<T>(binary: string, args: string[]): Promise<T> {
  const stdout = await run(binary, args);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`${binary} ${args.slice(0, 2).join(' ')} returned non-JSON output`);
  }
}
