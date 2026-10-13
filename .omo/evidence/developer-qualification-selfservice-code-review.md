# Code quality review — developer qualification self-service

## Result

- `codeQualityStatus`: **WATCH**
- `recommendation`: **APPROVE**
- Scope reviewed: uncommitted qualification self-service changes on `feature/managed-membership-qualifications`, `8e7a4e763b4c9e887295e8db45398a5b687e8a44`.
- Graph evidence: the available `nakwol-auth` graph points to the old `E:\Codex\낙월 인증기\nakwol-auth` checkout (generation `2026-09-27T10:21:51Z`). Its coverage does not include the new/changed route files, so this review used direct source and diff inspection.

## Findings

### CRITICAL

None.

### HIGH

1. **Resolved: policy writes now reject a revoked former owner.**
   - In the initial reviewed revision, `src/developer-qualifications.ts:39-46` checked `application_owners` in one statement, then returned an app record. The initial legacy deletion at `src/developer-qualifications.ts:95` and custom upsert at `src/developer-qualifications.ts:103-107` did not require that the caller remained an owner.
   - The current implementation fixes this with `mutationAccessSql` at `src/developer-qualifications.ts:11-16`. Both the legacy delete (`:101-109`) and custom upsert (`:117-129`) evaluate current active user/developer-or-operator status and current ownership in the mutation statement. The non-success branch rereads current identity and ownership before returning a result.
   - `tests/worker/developer-qualifications.test.ts:107-147` injects owner removal, developer disable, and user disable immediately before both mutation forms. Each of the six cases returned 403, preserved the stored policy, and emitted no audit event.

### MEDIUM

None.

### LOW

1. **The developer qualification catalog returns Discord role IDs that its callers do not use.**
   - `src/developer-qualifications.ts:33-36,63-66` returns `role_id` with each operator-published qualification. `src/developer-apps.ts:32` and `packages/connect-cli/src/qualifications.mjs:27-31` use the qualification ID and name only.
   - Discord role IDs are not credentials, so this is not an authorization bypass. Returning only the selectable qualification identity and display name would keep the operator-managed role mapping out of the developer-facing API.

## Verification

- Initial review: `npx tsx --test tests/worker/developer-qualifications.test.ts packages/connect-cli/test/qualifications.test.mjs`: **11 passed, 0 failed**.
- `npm run typecheck`: **passed** (`cli:pack` then `tsc --noEmit`).
- `npm run test:unit`: **287 passed, 0 failed, 0 skipped**.
- `git diff --check`: **passed**; observed line-ending warnings only.
- Re-review after the authorization fix: `npx tsx --test tests/worker/developer-qualifications.test.ts`: **4 passed, 0 failed**. This includes the six injected ownership/developer/user revocation cases.
- Migration review: `migrations/0017_developer_qualifications.sql` defaults publication to private and adds the two developer-page callbacks. Existing `0016` triggers reject custom-requirement writes after an access-policy race, which is why the new registry/access-policy race test passes.

## Skill-perspective check

The required `omo:remove-ai-slops` and `omo:programming` checks were loaded and applied before judging tests and maintainability.

- **remove-ai-slops:** no deletion-only, requested-removal, tautological, implementation-constant, or prose-pinning tests were found in the new qualification tests. The new CLI helper is used by `init`, `sync`, and `qualifications`, so it is not a one-use abstraction. No needless parsing/normalization beyond CLI boundary parsing was found.
- **programming:** no new TypeScript untyped escape hatch, prompt-text test, implementation-mirroring test, or needless abstraction was found in the reviewed additions. Boundary validation is required for the HTTP and CLI inputs. The ownership time-of-check/time-of-use gap above remains a correctness and authorization failure.

## Blockers

None. The previous ownership-revocation blocker is resolved.
