import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const allowedHeads = [];
const allowedPrefixes = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--allow-head') {
    const value = args[index + 1]?.trim();
    if (!value) throw new Error('ALLOW_HEAD_VALUE_REQUIRED');
    allowedHeads.push(value);
    index += 1;
    continue;
  }
  if (arg === '--allow-prefix') {
    const value = args[index + 1]?.trim();
    if (!value) throw new Error('ALLOW_PREFIX_VALUE_REQUIRED');
    allowedPrefixes.push(value);
    index += 1;
    continue;
  }
  throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
}

if (allowedHeads.length === 0 && allowedPrefixes.length === 0) {
  throw new Error('ALLOWED_PROMOTION_SOURCE_REQUIRED');
}

const eventName = process.env.GITHUB_EVENT_NAME?.trim() || '';
const refName = process.env.GITHUB_REF_NAME?.trim() || '';

// workflow_dispatch remains an explicit operator escape hatch, but production
// commands may only run from the stable ref. This prevents accidentally
// dispatching a production workflow against dev/main.
if (eventName !== 'push') {
  if (refName !== 'stable') {
    throw new Error(`MANUAL_PRODUCTION_REF_MUST_BE_STABLE:${refName || 'unknown'}`);
  }
  console.log('NAKWOL_STABLE_PROMOTION_MANUAL_OK:stable');
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY?.trim();
const sha = process.env.GITHUB_SHA?.trim();
const token = process.env.GITHUB_TOKEN?.trim();
const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
const apiOrigin = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

if (!repository || !repository.includes('/')) throw new Error('GITHUB_REPOSITORY_REQUIRED');
if (!/^[0-9a-f]{40}$/i.test(sha || '')) throw new Error('GITHUB_SHA_REQUIRED');
if (!token) throw new Error('GITHUB_TOKEN_REQUIRED');
if (!eventPath) throw new Error('GITHUB_EVENT_PATH_REQUIRED');

let pushEvent;
try {
  pushEvent = JSON.parse(await readFile(eventPath, 'utf8'));
} catch (error) {
  throw new Error(`STABLE_PUSH_EVENT_INVALID:${error instanceof Error ? error.message : String(error)}`);
}

// Free/private repositories cannot enforce native branch protection. Refuse
// non-fast-forward replay and malformed/unexpected push context before asking
// GitHub which PR is associated with the commit.
if (pushEvent?.forced !== false) throw new Error('STABLE_FORCE_PUSH_REJECTED');
if (pushEvent?.ref !== 'refs/heads/stable') {
  throw new Error(`STABLE_PUSH_REF_REQUIRED:${pushEvent?.ref || 'unknown'}`);
}
if (pushEvent?.after !== sha) {
  throw new Error(`STABLE_PUSH_SHA_MISMATCH:${pushEvent?.after || 'unknown'}:${sha}`);
}
if (pushEvent?.deleted === true) throw new Error('STABLE_BRANCH_DELETION_REJECTED');

const response = await fetch(`${apiOrigin}/repos/${repository}/commits/${sha}/pulls`, {
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'nakwol-stable-promotion-guard',
  },
});
const text = await response.text();
if (!response.ok) {
  throw new Error(`STABLE_PROMOTION_LOOKUP_FAILED:${response.status}:${text}`);
}

let pulls;
try {
  pulls = JSON.parse(text);
} catch {
  throw new Error('STABLE_PROMOTION_LOOKUP_INVALID_JSON');
}
if (!Array.isArray(pulls)) throw new Error('STABLE_PROMOTION_LOOKUP_INVALID_PAYLOAD');

function allowedHead(head) {
  return allowedHeads.includes(head) || allowedPrefixes.some((prefix) => head.startsWith(prefix));
}

const match = pulls.find((pull) => (
  pull?.merge_commit_sha === sha
  && pull?.base?.ref === 'stable'
  && typeof pull?.head?.ref === 'string'
  && allowedHead(pull.head.ref)
  && typeof pull?.merged_at === 'string'
  && pull.merged_at.length > 0
));

if (!match) {
  console.error(JSON.stringify({
    sha,
    allowedHeads,
    allowedPrefixes,
    candidates: pulls.map((pull) => ({
      number: pull?.number ?? null,
      merged_at: pull?.merged_at ?? null,
      merge_commit_sha: pull?.merge_commit_sha ?? null,
      base: pull?.base?.ref ?? null,
      head: pull?.head?.ref ?? null,
    })),
  }, null, 2));
  throw new Error('STABLE_PROMOTION_NOT_FROM_ALLOWED_PR');
}

console.log(`NAKWOL_STABLE_PROMOTION_OK:${match.head.ref}->stable:#${match.number}`);
