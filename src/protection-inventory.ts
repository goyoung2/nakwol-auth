/** Only bounded digests and counts enter central history; inventory paths stay local. */
export type ProtectionEvidenceSummary = {
  readonly release_accepted?: boolean;
  readonly manifest_hash?: string;
  readonly build_hash?: string;
  readonly authenticated_checked_count?: number;
};

export function parseProtectionEvidence(value: Record<string, unknown>): ProtectionEvidenceSummary | null {
  const accepted = value.release_accepted;
  const manifest = value.manifest_hash;
  const build = value.build_hash;
  const count = value.authenticated_checked_count;
  if (accepted !== undefined && typeof accepted !== 'boolean') return null;
  const present = manifest !== undefined || build !== undefined || count !== undefined;
  if (present && (typeof manifest !== 'string' || !/^[a-f0-9]{64}$/.test(manifest) || typeof build !== 'string' || !/^[a-f0-9]{64}$/.test(build) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 10000)) return null;
  if (accepted === true && (!present || count === 0 || value.status !== 'verified' || typeof value.deployment_id !== 'string')) return null;
  return {
    ...(accepted !== undefined ? { release_accepted: accepted } : {}),
    ...(typeof manifest === 'string' && typeof build === 'string' && typeof count === 'number' ? { manifest_hash: manifest, build_hash: build, authenticated_checked_count: count } : {}),
  };
}
