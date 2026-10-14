import type { Env } from './types';

export type QualificationMatchMode = 'any' | 'all';
export type ApplicationQualificationRequirement = {
  readonly match_mode: QualificationMatchMode;
  readonly qualification_ids: readonly string[];
};

export class QualificationSettingsError extends Error {
  readonly code = 'INVALID_QUALIFICATION_SETTINGS';
}

export function parseQualificationIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32 ||
      value.some((id: unknown) => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id))) {
    throw new QualificationSettingsError('인증 자격은 1개 이상, 최대 32개까지 선택할 수 있습니다.');
  }
  return [...new Set<string>(value)];
}

export function parseQualificationMatchMode(value: unknown): QualificationMatchMode {
  if (value !== 'any' && value !== 'all') throw new QualificationSettingsError('자격 조건은 any 또는 all이어야 합니다.');
  return value;
}

export async function getApplicationQualificationRequirement(env: Env, clientId: string): Promise<ApplicationQualificationRequirement | null> {
  const row = await env.DB.prepare(
    'SELECT match_mode, qualification_ids FROM application_qualification_requirements WHERE client_id = ?'
  ).bind(clientId).first<{ match_mode: string; qualification_ids: string }>();
  if (!row) return null;
  try {
    return { match_mode: parseQualificationMatchMode(row.match_mode), qualification_ids: parseQualificationIds(JSON.parse(row.qualification_ids)) };
  } catch (error) {
    if (error instanceof SyntaxError) throw new QualificationSettingsError('저장된 인증 자격 목록이 올바르지 않습니다.');
    throw error;
  }
}

export function evaluateQualificationSnapshot(selection: { readonly match_mode: string | null; readonly qualification_ids: string | null;
  readonly qualifications: string | null }, roles: readonly string[]) {
  try {
    const mode = parseQualificationMatchMode(selection.match_mode);
    const ids = parseQualificationIds(JSON.parse(selection.qualification_ids ?? 'null'));
    const registry: unknown = JSON.parse(selection.qualifications ?? 'null');
    if (!Array.isArray(registry)) throw new QualificationSettingsError('Invalid qualification snapshot');
    const roleIds = ids.map(id => {
      const qualification: unknown = registry.find((item: unknown) => typeof item === 'object' && item !== null && 'id' in item && item.id === id);
      if (typeof qualification !== 'object' || qualification === null || !('status' in qualification) || qualification.status !== 'active' ||
          !('role_id' in qualification) || typeof qualification.role_id !== 'string' || !/^[0-9]{17,20}$/.test(qualification.role_id)) {
        throw new QualificationSettingsError('Unknown or disabled qualification');
      }
      return qualification.role_id;
    });
    const missing = roleIds.filter(id => !roles.includes(id));
    return { valid: true, matched: mode === 'all' ? missing.length === 0 : missing.length < roleIds.length,
      match_mode: mode, qualification_ids: ids, missing_role_ids: missing };
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof QualificationSettingsError)) throw error;
    return { valid: false, matched: false, match_mode: null, qualification_ids: [], missing_role_ids: [] };
  }
}
