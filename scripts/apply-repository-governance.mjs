const token = process.env.REPO_ADMIN_TOKEN?.trim();
const repository = process.env.GITHUB_REPOSITORY?.trim();
const dryRun = process.argv.includes('--dry-run');

if (!repository || !repository.includes('/')) throw new Error('GITHUB_REPOSITORY_REQUIRED');
if (!dryRun && !token) throw new Error('REPO_ADMIN_TOKEN_REQUIRED');

const branches = ['dev', 'main', 'stable'];
const requiredChecks = ['governance', 'quality-gate'];

const protection = {
  required_status_checks: {
    strict: true,
    contexts: requiredChecks,
  },
  enforce_admins: true,
  required_pull_request_reviews: {
    dismissal_restrictions: {},
    dismiss_stale_reviews: false,
    require_code_owner_reviews: false,
    required_approving_review_count: 0,
    require_last_push_approval: false,
    bypass_pull_request_allowances: {},
  },
  restrictions: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  block_creations: false,
  required_conversation_resolution: false,
  lock_branch: false,
  allow_fork_syncing: false,
};

async function apply(branch) {
  const url = `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}/protection`;
  if (dryRun) {
    console.log(JSON.stringify({ branch, url, protection }, null, 2));
    return;
  }
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'nakwol-repository-governance',
    },
    body: JSON.stringify(protection),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`BRANCH_PROTECTION_FAILED:${branch}:${response.status}:${text}`);
  console.log(`NAKWOL_BRANCH_PROTECTION_OK:${branch}`);
}

for (const branch of branches) await apply(branch);
console.log(`NAKWOL_REPOSITORY_GOVERNANCE_OK:${branches.join(',')}`);
