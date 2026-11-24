# Secrets and manual steps

Read this file when a run needs an external secret (`orc-secret`) or leaves a post-delivery manual step for the user (`orc-manual-step`).

## Secrets

Never ask the user to paste a secret into chat or run a storage command. Run
`orc-secret check <NAME>`; when missing, run `orc-secret request <NAME>
--reason "<what it unlocks>"`, state what it unlocks, and end the turn. Orc
stores the value in the local credential store (macOS Keychain or Windows
credential store) via a chat password field and sends a message when saved or
dismissed. Read it only inside the command that needs it
(`"$(security find-generic-password -a "$USER" -s <NAME> -w)"` on macOS, or
`"$(orc-secret read <NAME>)"` on WSL/Windows) — never print, log, or commit it.

## Steps for the user

When the result requires a post-delivery user action (apply a migration, start
or deploy a service, change a dashboard setting, run a command elsewhere),
record each step before stopping:

```bash
orc-manual-step add --run-dir "$RUN_DIR" --title "<instruction>" \
  --command '<cd <main checkout> && command>' --detail "<why>"
```

Orc lists recorded steps above the composer and blocks settling the run until
every step is ticked. Commands must target `<main checkout>` (never the
ephemeral worktree); omit `--command` when none applies. Name the steps in the
reply too, and never record agent-owned work or optional checks. Use
`orc-manual-step done <id>`, `remove <id>`, and `list` to manage steps.
