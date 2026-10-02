import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readProjectConfig} from './config.mjs';
import {readAutomaticConnection} from './portable-rollout.mjs';

const sha=/^[a-f0-9]{40}$/;
function version(value) {
  if(typeof value!=='string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('Auto-merge requires exact stable versions.');
  const parts=value.split('.').map(Number);
  if(!parts.every(Number.isSafeInteger)) throw new Error('Invalid auto-merge version.');
  return parts;
}
export function validatePatchFiles({basePackage,nextPackage,baseLock,nextLock}) {
  const previous=basePackage?.devDependencies?.['nakwol-connect'],next=nextPackage?.devDependencies?.['nakwol-connect'];
  const a=version(previous),b=version(next);
  if(a[0]!==b[0] || a[1]!==b[1] || b[2]<=a[2]) throw new Error('Only an SDK patch upgrade is automatically eligible.');
  const normalized=structuredClone(nextPackage);normalized.devDependencies['nakwol-connect']=previous;
  if(basePackage.dependencies?.['nakwol-connect'] || nextPackage.dependencies?.['nakwol-connect'] || !isDeepStrictEqual(basePackage,normalized)) throw new Error('Auto-merge may only change the SDK version, not scripts or other settings.');
  if(baseLock?.lockfileVersion!==3 || nextLock?.lockfileVersion!==3) throw new Error('Automatic updates require a v3 npm lockfile.');
  const oldEntry=baseLock.packages?.['node_modules/nakwol-connect'],entry=nextLock.packages?.['node_modules/nakwol-connect'];
  const tarball=`https://registry.npmjs.org/nakwol-connect/-/nakwol-connect-${next}.tgz`;
  if(oldEntry?.version!==previous || entry?.version!==next || baseLock.packages?.['']?.devDependencies?.['nakwol-connect']!==previous || nextLock.packages?.['']?.devDependencies?.['nakwol-connect']!==next || entry.resolved!==tarball || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity||'')) throw new Error('Auto-merge lockfile/registry binding mismatch.');
  const normalizedLock=structuredClone(nextLock);
  normalizedLock.packages[''].devDependencies['nakwol-connect']=previous;
  for(const key of ['version','resolved','integrity']) {
    if(Object.hasOwn(oldEntry,key)) normalizedLock.packages['node_modules/nakwol-connect'][key]=oldEntry[key];
    else delete normalizedLock.packages['node_modules/nakwol-connect'][key];
  }
  if(!isDeepStrictEqual(baseLock,normalizedLock)) throw new Error('Auto-merge refuses transitive dependency or unrelated lockfile changes.');
  return {previousVersion:previous,version:next,tarball,integrity:entry.integrity};
}

export async function requestPatchAutoMerge(options={}) {
  const root=options.root||process.cwd(),config=await readProjectConfig(root);
  if(config?.protection?.automation?.autoMerge!==true) throw new Error('Patch auto-merge is not enabled for this site.');
  // Only static owner-reviewed configuration is read in this privileged job.
  // Fresh baseline and provider verification belong to the serialized release job.
  await readAutomaticConnection(root,config);
  const repository=options.repository||process.env.GITHUB_REPOSITORY;
  if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')) throw new Error('Invalid GitHub repository binding.');
  const token=options.apiToken||process.env.GITHUB_TOKEN;
  if(!token) throw new Error('GITHUB_TOKEN is required for patch auto-merge.');
  const bytes=await readFile(options.eventFile||process.env.GITHUB_EVENT_PATH);
  if(bytes.length>256*1024) throw new Error('GitHub event exceeds size limit.');
  const event=JSON.parse(bytes),runId=event.workflow_run?.id;
  if(!Number.isSafeInteger(runId) || runId<=0) throw new Error('Auto-merge requires a completed workflow_run.');
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  async function json(url,body,authenticated=true) {
    let response;
    try {response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Accept:'application/vnd.github+json',...(authenticated?{Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});} catch {throw new Error('Auto-merge API request failed.');}
    if(!response.ok) throw new Error(`Auto-merge API refused the request (HTTP ${response.status}).`);
    const text=await response.text();if(Buffer.byteLength(text)>8*1024*1024) throw new Error('Auto-merge API response exceeds size limit.');
    return JSON.parse(text);
  }
  const base=`https://api.github.com/repos/${repository}`;
  const repo=await json(base),run=await json(`${base}/actions/runs/${runId}`);
  const workflow=await json(`${base}/actions/workflows/nakwol-gate-check.yml`);
  if(!repo.default_branch || run.workflow_id!==workflow.id || workflow.path!=='.github/workflows/nakwol-gate-check.yml' || run.event!=='pull_request' || run.status!=='completed' || run.conclusion!=='success' || run.head_repository?.full_name!==repository || run.pull_requests?.length!==1) throw new Error('Auto-merge requires the trusted successful PR check workflow.');
  const number=run.pull_requests[0].number;
  if(!Number.isSafeInteger(number) || number<=0) throw new Error('Invalid PR binding.');
  const pr=await json(`${base}/pulls/${number}`);
  if(pr.state!=='open' || pr.draft || pr.user?.login!=='dependabot[bot]' || pr.user?.type!=='Bot' || pr.base?.repo?.full_name!==repository || pr.head?.repo?.full_name!==repository || pr.base.ref!==repo.default_branch || !sha.test(pr.base.sha||'') || !sha.test(pr.head.sha||'') || pr.head.sha!==run.head_sha || typeof pr.node_id!=='string') throw new Error('Auto-merge refuses an untrusted, retargeted or stale PR.');
  const changed=await json(`${base}/pulls/${number}/files?per_page=100`);
  if(!Array.isArray(changed) || changed.length!==2 || !['package.json','package-lock.json'].every(file=>changed.some(item=>item.filename===file && item.status==='modified' && !item.previous_filename))) throw new Error('Auto-merge permits only package.json and package-lock.json.');
  async function source(file,ref) {
    const data=await json(`${base}/contents/${file}?ref=${ref}`);
    if(data.encoding!=='base64' || typeof data.content!=='string' || data.content.length>6*1024*1024) throw new Error('Unsupported package source response.');
    return JSON.parse(Buffer.from(data.content,'base64').toString('utf8'));
  }
  const files={basePackage:await source('package.json',pr.base.sha),nextPackage:await source('package.json',pr.head.sha),baseLock:await source('package-lock.json',pr.base.sha),nextLock:await source('package-lock.json',pr.head.sha)};
  const patch=validatePatchFiles(files);
  const registry=await json(`https://registry.npmjs.org/nakwol-connect/${patch.version}`,undefined,false);
  if(registry.name!=='nakwol-connect' || registry.version!==patch.version || registry.dist?.tarball!==patch.tarball || registry.dist?.integrity!==patch.integrity) throw new Error('Published SDK metadata differs from the reviewed lockfile.');
  const protection=await json(`${base}/branches/${encodeURIComponent(repo.default_branch)}/protection`);
  const checks=protection.required_status_checks;
  if(!Number.isSafeInteger(run.check_suite_id)) throw new Error('Gate check suite identity is missing.');
  const suite=await json(`${base}/check-suites/${run.check_suite_id}`);
  const jobs=await json(`${base}/actions/runs/${runId}/jobs?per_page=100`);
  const bypass=protection.required_pull_request_reviews?.bypass_pull_request_allowances;
  if(protection.enforce_admins?.enabled!==true || checks?.strict!==true || !(checks.checks||[]).some(check=>check.context==='check' && check.app_id===suite.app?.id) || suite.app?.slug!=='github-actions' || !Number.isSafeInteger(suite.app?.id) || !Array.isArray(jobs.jobs) || jobs.total_count!==jobs.jobs.length || !jobs.jobs.some(job=>job.name==='check' && job.conclusion==='success') || bypass && ['users','teams','apps'].some(key=>bypass[key]?.length)) throw new Error('Auto-merge requires strict enforced branch protection and the actual successful gate check app.');
  const latest=await json(`${base}/pulls/${number}`),tip=await json(`${base}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`);
  if(latest.state!=='open' || latest.base?.sha!==pr.base.sha || latest.head?.sha!==pr.head.sha || latest.base?.ref!==pr.base.ref || tip.object?.sha!==pr.base.sha) throw new Error('PR or base changed during validation; auto-merge refused.');
  // One atomic, exact-head merge. Do not arm PR-wide auto-merge for future commits.
  // GitHub still enforces all remaining protected-branch checks and reviews.
  const result=await json('https://api.github.com/graphql',{query:'mutation($input: MergePullRequestInput!) { mergePullRequest(input:$input) { pullRequest { number merged mergeCommit { oid } } } }',variables:{input:{pullRequestId:pr.node_id,expectedHeadOid:pr.head.sha,mergeMethod:'SQUASH',clientMutationId:randomUUID()}}});
  const merged=result.data?.mergePullRequest?.pullRequest;
  if(result.errors?.length || merged?.number!==number || merged.merged!==true || !sha.test(merged.mergeCommit?.oid||'')) throw new Error('GitHub did not merge the inspected patch; remaining checks/reviews or a changed head may block it.');
  return {ok:true,status:'patch-merged',deployed:false,repository,pullRequest:number,baseSha:pr.base.sha,headSha:pr.head.sha,mergeSha:merged.mergeCommit.oid,...patch,limitations:['The exact SDK patch was merged. Deployment and operational verification are separate states.']};
}
