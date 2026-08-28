# NAKWOL Repository Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `goyoung2/nakwol-auth` to a documented and enforceable `dev -> main -> stable -> component release` operating model before Codex handoff.

**Architecture:** Keep the existing monorepo and CI, but separate integration, release-candidate, and production responsibilities by long-lived branch. Add one always-on repository governance gate, move every production/publish trigger to `stable`, codify admin branch protections, and create an auditable component-prefixed release workflow driven by a committed release descriptor.

**Tech Stack:** GitHub branches/PRs, GitHub Actions YAML, Node.js 22, GitHub CLI inside Actions, existing TypeScript/Node test suites.

**Spec:** `docs/superpowers/specs/2026-08-28-repository-governance-design.md`

## Global Constraints

- Long-lived promotion order is `dev -> main -> stable`.
- Normal feature/fix/chore/docs branches originate from and return to `dev`.
- Production Cloudflare deployment and npm publication are `stable`-only.
- `main` is release-candidate only and must not auto-deploy production.
- `stable` normal source is `main`; `hotfix/*` is the only emergency exception.
- Release tags are component-prefixed: `data-vX.Y.Z`, `connect-vX.Y.Z`, `auth-vX.Y.Z`.
- Current DATA release is `data-v0.8.0`, exact deploy commit `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`.
- Branch protection requires PR + CI, forbids force-push/deletion, and requires zero external approvals because this is a solo repository.
- Connected GitHub actions cannot directly write rulesets or delete refs; those limitations must be explicit rather than hidden.

---

### Task 1: Repository governance contract and handoff docs

**Files:**
- Create: `BRANCHING.md`
- Create: `CODEX_HANDOFF.md`
- Create: `tests/repository-governance.test.ts`

**Interfaces:**
- Consumes: current production facts from `DATA.md` and this spec.
- Produces: human/Codex branch contract and an automated static contract used by later workflow tasks.

- [ ] **Step 1: Write failing governance test**

Add tests that read workflow/document files and require:

```ts
assert.match(branching, /dev\s*->\s*main\s*->\s*stable/);
assert.match(handoff, /DATA 0\.8\.0/);
assert.match(handoff, /canonical applicability.*0/i);
assert.match(verify, /branches:[\s\S]*dev[\s\S]*main[\s\S]*stable/);
assert.match(deploy, /branches:[\s\S]*stable/);
assert.doesNotMatch(deploy, /branches:[\s\S]*- main/);
assert.match(dataDeploy, /branches:\s*\[stable\]/);
assert.match(publishNpm, /branches:[\s\S]*stable/);
assert.match(productionSmoke, /branches:[\s\S]*stable/);
```

- [ ] **Step 2: Run root tests and confirm RED**

Run: `npm test`
Expected: governance test fails because docs do not exist and workflows still target `main`.

- [ ] **Step 3: Write `BRANCHING.md`**

Document normal flow, hotfix flow, branch naming, PR bases, prohibited direct development, stable-only deployment, and component release naming.

- [ ] **Step 4: Write `CODEX_HANDOFF.md`**

Freeze current DATA 0.8 production IDs, required first-read docs, root/DATA test commands, deferred equipment evidence domains, stale-branch warning, release process, and explicit no-invented-game-rules rule.

- [ ] **Step 5: Commit contract/docs RED-to-partial-GREEN checkpoint**

Commit message: `docs(repo): add branching and Codex handoff contract`

### Task 2: Long-lived branch CI and stable-only production triggers

**Files:**
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/verify-data.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/deploy-data.yml`
- Modify: `.github/workflows/bootstrap-data.yml`
- Modify: `.github/workflows/publish-npm.yml`
- Modify: `.github/workflows/production-smoke.yml`
- Create: `.github/workflows/repository-governance.yml`
- Modify: `tests/repository-governance.test.ts`

**Interfaces:**
- Consumes: branch policy from Task 1.
- Produces: PR verification on all long-lived branches and production/publish execution only from stable.

- [ ] **Step 1: Extend failing tests to exact branch triggers**

Require:

```ts
for (const workflow of [verify, verifyData]) {
  assert.match(workflow, /dev/);
  assert.match(workflow, /main/);
  assert.match(workflow, /stable/);
}
for (const workflow of [deploy, deployData, bootstrapData, publishNpm]) {
  assert.match(workflow, /stable/);
}
```

- [ ] **Step 2: Update verify workflows**

Change PR base filters from only `main` to `dev`, `main`, `stable` without weakening existing tests/typecheck/bundle steps.

- [ ] **Step 3: Move production-capable workflows to stable**

Change AUTH/Connect deploy, DATA deploy, DATA bootstrap flag, npm publish flag, and production-smoke PR base from `main` to `stable`. Preserve manual `workflow_dispatch` where it already exists.

- [ ] **Step 4: Add always-on governance gate**

Create `.github/workflows/repository-governance.yml` for every PR to `dev/main/stable`. The job must fail when:

```bash
base=dev    && head does not match feature/*|fix/*|chore/*|docs/*|main
base=main   && head is neither dev nor stable
base=stable && head is neither main nor hotfix/*|release/*
```

Allow `release/* -> stable` because release-descriptor PRs occur only after successful production smoke.

- [ ] **Step 5: Run root tests**

Run: `npm test`
Expected: governance static contract passes along with existing root tests.

- [ ] **Step 6: Commit**

Commit message: `ci(repo): enforce dev main stable promotion flow`

### Task 3: Auditable GitHub Release automation

**Files:**
- Create: `.github/workflows/create-component-release.yml`
- Create: `ops/release.json`
- Modify: `tests/repository-governance.test.ts`
- Modify: `BRANCHING.md`
- Modify: `CODEX_HANDOFF.md`

**Interfaces:**
- Consumes: a committed release descriptor merged from `release/* -> stable`.
- Produces: immutable component-prefixed tag and GitHub Release through GitHub Actions `GITHUB_TOKEN` with `contents: write`.

- [ ] **Step 1: Add release workflow contract test**

Require workflow to trigger only on `stable` changes to `ops/release.json`, validate component/version/target SHA, reject an existing tag, and call `gh release create`.

- [ ] **Step 2: Add safe no-op release descriptor**

Initial `ops/release.json`:

```json
{"enabled":false,"component":"data","version":"0.8.0","target_sha":"5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61","notes_file":"docs/releases/2026-08-27-nakwol-data-v0.8.md"}
```

- [ ] **Step 3: Implement workflow**

On stable push to the descriptor path:

```bash
if enabled != true: exit 0
TAG="${component}-v${version}"
git cat-file -e "${target_sha}^{commit}"
git merge-base --is-ancestor "$target_sha" stable
gh release view "$TAG" -> fail if it already exists
gh release create "$TAG" --target "$target_sha" --title "$TAG" --notes-file "$notes_file"
```

- [ ] **Step 4: Document release descriptor lifecycle**

`release/*` PR changes enabled to true and exact release values; after release success a later housekeeping PR may set enabled false without deleting history.

- [ ] **Step 5: Run root tests and commit**

Commit message: `ci(repo): add component release automation`

### Task 4: Codified branch protection/ruleset administration

**Files:**
- Create: `scripts/apply-repository-governance.mjs`
- Create: `.github/workflows/apply-repository-governance.yml`
- Modify: `tests/repository-governance.test.ts`
- Modify: `BRANCHING.md`
- Modify: `CODEX_HANDOFF.md`

**Interfaces:**
- Consumes: `REPO_ADMIN_TOKEN` with repository Administration write permission.
- Produces: reproducible protection configuration for dev/main/stable.

- [ ] **Step 1: Test governance script text contract**

Require all three branch names, required PR checks, `required_approving_review_count: 0`, `allow_force_pushes: false`, and `allow_deletions: false`.

- [ ] **Step 2: Implement admin script**

Use GitHub REST `PUT /repos/{owner}/{repo}/branches/{branch}/protection` for each long-lived branch with strict status checks and required pull-request reviews. Fail if token/repository variables are absent.

- [ ] **Step 3: Add manual workflow**

`workflow_dispatch` only, using `${{ secrets.REPO_ADMIN_TOKEN }}` and `GITHUB_REPOSITORY`. No automatic execution.

- [ ] **Step 4: Document real-vs-codified state**

Until an admin token run succeeds, handoff must say protections are codified but not applied.

- [ ] **Step 5: Run root tests and commit**

Commit message: `ops(repo): codify long-lived branch protection`

### Task 5: Governance PR verification and bootstrap merge

**Files:** governance branch diff only.

- [ ] **Step 1: Run full root verification**

Run:

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
```

- [ ] **Step 2: Run full DATA verification**

Run from `services/data`:

```bash
npm test
npm run typecheck
npm run bundle
```

- [ ] **Step 3: Open governance PR to current main**

Title: `Establish dev main stable repository governance`

- [ ] **Step 4: Inspect full diff and CI**

Reject any accidental production code/schema change. The PR should contain docs, workflows, governance tests/scripts, and release descriptor only.

- [ ] **Step 5: Merge with expected governance HEAD**

Record merge commit as the governance baseline.

### Task 6: Create dev/stable, archive stale path, create DATA v0.8 GitHub Release

**Files/Refs:**
- Create branches `dev`, `stable` from governance main merge commit.
- Close PR #5 with archival note.
- Create a temporary `release/data-v0.8.0` branch from `stable`.
- Modify `ops/release.json` on release branch.

- [ ] **Step 1: Create `dev` and `stable`**

Both must point to the exact governance merge commit before any release descriptor PR.

- [ ] **Step 2: Verify branch equality**

Compare `dev`, `main`, `stable`; expected ahead/behind = 0 immediately after bootstrap.

- [ ] **Step 3: Archive stale draft PR #5**

Update body explaining it is historical/diverged and close it. Do not merge it.

- [ ] **Step 4: Open release descriptor PR**

From `release/data-v0.8.0` to `stable`, set `enabled:true` with exact target `5cfe6c...` and v0.8 notes file.

- [ ] **Step 5: Merge release PR and verify release workflow**

Confirm GitHub Release `data-v0.8.0` exists and targets exact deploy commit.

- [ ] **Step 6: Document stale refs**

Because branch deletion is unavailable through the connected tool surface, list historical feature/ops branches in `CODEX_HANDOFF.md` as non-authoritative and never valid branch bases.

### Task 7: Final handoff verification

- [ ] **Step 1: Verify refs**

Confirm `dev`, `main`, `stable` exist; account for any expected stable-only release descriptor commit after release creation.

- [ ] **Step 2: Verify production workflows**

Read workflow files from `stable` and confirm production/publish branch triggers contain stable and not main.

- [ ] **Step 3: Verify release metadata**

Confirm `data-v0.8.0`, target SHA, title, and release notes.

- [ ] **Step 4: Verify stale PR state**

PR #5 must be closed and explicitly archived.

- [ ] **Step 5: Verify branch-protection state**

If admin workflow was not run, report it as the only remaining GitHub Settings action; do not claim protection is active.

- [ ] **Step 6: Final Codex handoff checkpoint**

Codex starts from `dev`; current production DATA remains 0.8.0/schema3; equipment applicability/base-stat authoritative data remains deferred until supplied by the user.
