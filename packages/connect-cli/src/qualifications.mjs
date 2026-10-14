import { createInterface } from 'node:readline/promises';

export function qualificationInput(options = {}) {
  if (options.qualificationLegacy) {
    if (options.qualifications !== undefined || options.qualificationMatch !== undefined) throw new Error('--qualification-legacy는 자격 선택 옵션과 함께 사용할 수 없습니다.');
    return { mode:'legacy' };
  }
  if (options.qualifications === undefined) {
    if (options.qualificationMatch !== undefined) throw new Error('--qualification-match에는 --qualifications가 필요합니다.');
    return null;
  }
  const ids = String(options.qualifications).split(',').map(value => value.trim());
  if (ids.length > 32 || ids.some(value => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))) throw new Error('--qualifications에는 비어 있지 않은 자격 ID를 쉼표로 구분해 입력하세요.');
  const match = options.qualificationMatch ?? 'any';
  if (!['any','all'].includes(match)) throw new Error('--qualification-match는 any 또는 all이어야 합니다.');
  return { mode:'custom', match_mode:match, qualification_ids:[...new Set(ids)] };
}

export function requireMemberQualifications(input, accessPolicy) {
  if (input && accessPolicy !== 'member') throw new Error('가입 자격은 member 앱에서만 설정할 수 있습니다. --access-policy member를 명시하세요.');
}

export async function selectQualifications(api, options = {}) {
  const explicit = qualificationInput(options);
  if (explicit) return explicit;
  if (!options.interactive || options.json) return null;
  const { qualifications = [] } = await api.listQualifications();
  const available = qualifications.filter(item => item.status === 'active' && item.developer_selectable);
  const output = options.output || console.log;
  output('사이트 가입 자격을 선택하세요. Enter: 현재 조건 유지 (새 앱은 기존 기본 조건).');
  available.forEach((item, index) => output(`${index + 1}. ${item.name} (${item.id})`));
  if (!available.length) return null;
  const terminal = options.ask ? null : createInterface({ input:process.stdin, output:process.stdout });
  const ask = options.ask || (question => terminal.question(question));
  try {
    const answer = (await ask('선택 번호 (쉼표 구분): ')).trim();
    if (!answer) return null;
    const selected = answer.split(',').map(value => {
      const number = value.trim();
      if (!/^[1-9][0-9]*$/.test(number) || !available[Number(number) - 1]) throw new Error('목록에 있는 자격 번호를 입력하세요.');
      return available[Number(number) - 1].id;
    });
    const match = (await ask('충족 방식 any(하나 이상) / all(모두) [any]: ')).trim() || 'any';
    return qualificationInput({ qualifications:selected.join(','), qualificationMatch:match });
  } finally { terminal?.close(); }
}

export function qualificationManagerUrl(origin, clientId) {
  return `${String(origin).replace(/\/$/, '')}/developer/apps?client_id=${encodeURIComponent(clientId)}`;
}
