# NAKWOL Connect v0.3 Release Record

Released: 2026-08-27 KST

## Golden release

- `nakwol-connect@0.3.0`
- NAKWOL AUTH / Connect production: `https://nakwol-auth.sepsd21.workers.dev`
- NAKWOL DATA production: `https://nakwol-data.sepsd21.workers.dev`
- DATA service `0.3.0`, schema `2`
- Merge commit: `fc56fd757116f48090dd68cd5d1a4544bbc50881`
- PR: `#11 Automate NAKWOL Connect DATA integration v0.3`

## Verified developer flow

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect doctor --json
```

After a reusable CLI session exists, AUTH app registration/reuse, exact DATA scope sync, project marker/config editing and three-way doctor verification are automatic. The only intentional human boundary is the first short-lived Connect device approval on a machine without a reusable session.

Browser runtime:

```js
const generals = await window.NAKWOL_CONNECT.data.registry.generals();
const tactics = await window.NAKWOL_CONNECT.data.registry.tactics();
```

The runtime injects the current app access token and `X-NAKWOL-CLIENT-ID`. No CLI token or permanent secret is written to the project/browser.

## Verification evidence

PR verification, first attempt only:
- AUTH/CLI: 35/35 tests, typecheck and Wrangler bundle PASS
- DATA: 33/33 tests, typecheck and Wrangler bundle PASS

Production AUTH deploy:
- Workflow run `32997985211`
- Worker deploy success
- `/connect/v1.js`, CLI manifest `0.3.0`, package fallback, `/llms.txt`, device approval page all returned 200
- Final marker: `NAKWOL_CONNECT_V03_DEPLOY_OK`

Production DATA deploy:
- Workflow run `32998229713`
- 33/33 tests PASS
- DATA schema remains `2`, no migration pending
- Registry UPSERT success and exact counts preserved: generals 209 / visible 140 / tactics 1077 / equipment 134 / stat types 281 / formations 8 / warbooks 442
- Final marker: `NAKWOL_DATA_DEPLOY_OK`

npm Trusted Publishing:
- Workflow run `32998374612`
- first-token steps skipped
- OIDC Trusted Publishing step succeeded with empty `NODE_AUTH_TOKEN`
- published `+ nakwol-connect@0.3.0`
- registry-installed CLI executed and reported `NAKWOL Connect CLI v0.3`
- final marker: `NAKWOL_CONNECT_NPM_PUBLISH_OK`

## Trust boundary

- No new permanent DATA admin secret.
- DATA control requests delegate CLI app-management proof to AUTH on every request.
- DATA does not store or interpret the CLI token.
- Runtime DATA authorization still uses the app-bound user access token and AUTH `/me` verification.
- AUTH D1 and DATA D1 remain separate.
