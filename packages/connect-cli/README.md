# nakwol-connect

Official agent-first CLI for connecting web projects to NAKWOL AUTH.

The intended usage is simple enough for a coding agent/LLM to run without asking a human which file to edit:

```bash
npx nakwol-connect init
npx nakwol-connect doctor --json
```

`init` detects the project framework, authenticates through NAKWOL Connect device authorization when needed, creates or reuses the central application, installs the integration idempotently, writes `.nakwol-connect.json`, and validates the result.

## Commands

```text
init                 detect project → register/reuse app → install → verify
doctor               validate local and central integration; non-zero on failure
status               show current project connection state
add-url <URL>        add an exact Redirect URI
sync                 reconcile central settings and local integration
remove               remove local integration/config; central app is preserved
```

## First authentication

If the machine has no reusable CLI session, the CLI prints and opens a short-lived NAKWOL Connect approval URL. An authorized `developer` or `operator` approves it once in the browser. The resulting CLI token is stored in the user's home directory, never inside the project repository.

## Project state

The CLI writes `.nakwol-connect.json`. It contains no secret and may be committed to source control.

## Agent discovery

Machine-readable/current integration guidance is published at:

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
```

Do not implement Discord OAuth independently when integrating a NAKWOL service; use this CLI or the official NAKWOL AUTH SDK.

## Requirements

- Node.js 20 or newer
- Network access to `https://nakwol-auth.sepsd21.workers.dev`

## License

MIT
