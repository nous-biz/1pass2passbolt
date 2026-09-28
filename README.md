# 1pass2passbolt

Migrate 1Password vaults into Passbolt folders from the terminal.

- **One item becomes exactly one resource.** Items with a password or TOTP use Passbolt's native types (`v5-default`, `v5-default-with-totp`, `v5-totp-standalone`), so browser autofill works. Every other field is attached to the same resource as a v5 custom field.
- **Original labels are kept.** A 1Password field called "Dev Password" is still called "Dev Password" in Passbolt. Nothing is folded into the description.
- **Safe to rerun.** A local ledger plus matching on name, username and URI means reruns never create duplicates. `plan` is a dry run of `import`.
- **Checked field by field.** `verify` compares every migrated value with the export, not just the item count.

It drives the official CLIs, [`op`](https://developer.1password.com/docs/cli/) and [`go-passbolt-cli`](https://github.com/passbolt/go-passbolt-cli). It does not use CSV: Passbolt's CSV import has a long-standing bug where folders aren't created, and it has no TOTP format.

## Requirements

- Node.js >= 22.12 and pnpm
- `op`, signed in to the source account
- `passbolt` (go-passbolt-cli), configured with `passbolt configure` using **your own** Passbolt key. Set a non-interactive MFA mode (`none` or `noninteractive-totp`). The default, `interactive-totp`, blocks a batch run on a prompt for every call.

## Install

```bash
pnpm add -g https://github.com/nous-biz/1pass2passbolt/releases/latest/download/1pass2passbolt.tgz
```

## Usage

```bash
# 0. Check both CLIs are installed, signed in and non-interactive
1pass2passbolt -a example.1password.com doctor

# 1. Export a vault (full item JSON, plaintext secrets, mode 0600)
1pass2passbolt -a example.1password.com export -v "Employee"

# 2. Dry run: what would be created, what's already there, what needs a human
1pass2passbolt -a example.1password.com plan -v "Employee" -f "Employee"

# 3. Create what's missing (asks for confirmation; -y to skip)
1pass2passbolt -a example.1password.com import -v "Employee" -f "Employee"

# 4. Compare every migrated field with the export
1pass2passbolt -a example.1password.com verify -v "Employee" --all

# 5. Delete the local export and ledger
1pass2passbolt clean
```

`-f/--folder` defaults to the vault name. Folder names must match exactly. If several folders share the name, or only a case-insensitive match exists, the command stops and asks you to pass `--folder-id`. It never guesses and never creates a look-alike folder.

Global options: `-s/--state-dir <dir>` (default `./.1pass2passbolt`) and `-a/--account <address>`. Exports are stored per account, so pass the same `-a` to `export`, `plan`, `import` and `verify`.

### How `plan`/`import` decide

| Bucket | Meaning |
|---|---|
| `create` | No resource in the folder has the item's name, username and URI. `import` creates it. |
| `present` | Already migrated, either recorded in the ledger or matched by name, username and URI. When a matched group has as many resources as items (duplicates), the items count as present but aren't paired in the ledger, so `verify` skips them. |
| `ambiguous` | More items than resources share the same name, username and URI, so there's no way to tell which one is missing. Resolve these by hand. |
| `manual` | `DOCUMENT` items (`op item get` doesn't export attachments; use `op document get`) or items with no content. |

### Field mapping

| 1Password field | Passbolt |
|---|---|
| first `USERNAME` | native username |
| first `PASSWORD` field; if there is none, the first other secret (`CONCEALED`, `SSHKEY`, `CREDIT_CARD_NUMBER`) | native password |
| first `OTP` (base32 seed or `otpauth://`) | native TOTP |
| further `OTP` fields | `password` custom field (seed encrypted) |
| remaining secrets (`CONCEALED`, `SSHKEY`, `CREDIT_CARD_NUMBER`) | `password` custom field (value encrypted) |
| notes | `text` custom field labelled `notes` |
| extra `URL` fields | `uri` custom field |
| string, address, email, phone, date, menu... | `text` custom field |
| any other or future field type | `text` custom field (never dropped) |

An item with no secret at all and no TOTP becomes a `v5-custom-fields` resource. A lone API key or SSH key therefore lands in the native password slot, where it can be copied like any password. With `v5-totp-standalone`, which has no username slot, the username is kept as a custom field.

## Security notes

- The state dir holds **plaintext secrets**. Directories are `0700` and files `0600`. Run `clean` when you're done.
- go-passbolt-cli only accepts secrets as command-line arguments, so they're briefly visible to other processes of the same machine (for example in `ps`). Run migrations on a machine you trust. The tool never uses a shell, and it never prints an argv or a secret value in logs or errors.
- `verify` reports field labels, never values. `MISMATCH` (a value or type differs) fails the command. `LABELS` (the same value stored under another label, for example after a manual rename) is only reported.

## Development

```bash
pnpm install
pnpm start --help      # runs src/ directly (Node strips the types)
pnpm typecheck
pnpm test
pnpm build             # emits dist/
```

Layout: `src/domain` holds the pure mapping and planning rules, `src/app` the use cases and the ports they depend on, `src/adapters` the `op`, `passbolt` and filesystem implementations, and `src/cli.ts` the commander wiring.

To release, bump `version` in `package.json`, merge, then push a matching `vX.Y.Z` tag. The release workflow publishes `1pass2passbolt.tgz`.

## License

MIT
