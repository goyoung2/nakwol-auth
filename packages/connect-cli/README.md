# @nakwol/connect

Agent-first CLI for connecting a web project to NAKWOL AUTH.

## Primary command

After npm publication:

```bash
npx @nakwol/connect init
```

Before npm publication, use the Worker-hosted package:

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/package.tgz -- nakwol-connect init
```

The CLI detects the project, authenticates through one-time browser approval when needed, creates or reuses a NAKWOL Connect application, installs the integration, writes `.nakwol-connect.json`, and verifies the result.

Commands: `init`, `doctor`, `status`, `add-url`, `sync`, `remove`.
