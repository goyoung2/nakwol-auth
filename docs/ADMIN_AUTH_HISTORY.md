# 인증 문제 기록 조회와 추출

운영자는 `/admin/apps`에서 서비스를 선택하고 **인증 문제 전체 조회 · 내보내기**를 사용합니다.

- 기본은 재확인을 포함한 전체 문제 기록입니다. 역할·재인증 확인 필요, 재확인을 제외한 권한 거부와 인증 오류, 오류만, 관리자 조치를 포함한 전체 기록도 고를 수 있습니다.
- 기간은 전체 보관 기간 또는 최근 7·30·90일(현재 시각부터의 구간)이며, Discord ID를 함께 지정할 수 있습니다.
- 사유별 집계는 첫 화면 50건이 아닌 조건에 맞는 전체 기록을 집계합니다. 사유별 사용자 수에는 중복이 있으므로 더해서 전체 사용자 수로 해석하지 마세요.
- 화면은 50건씩, 내보내기는 페이지당 최대 200건씩 조회합니다. JSON·CSV는 모든 페이지 수집이 끝나야 저장합니다. 진행 중 취소·요청 실패·건수 불일치 시 일부 결과를 전체 파일로 저장하지 않습니다.
- 기준 시각을 고정해 페이지를 읽는 동안 새로 들어오는 기록이 섞이지 않게 합니다. 서비스를 변경하면 이전 조회·내보내기를 취소합니다.
- JSON은 긴 Discord ID와 저장된 상세 원본을 보존합니다. CSV는 UTF-8 BOM, 따옴표 이스케이프, 수식 시작 문자 무력화를 적용합니다. 스프레드시트에서 긴 ID를 자동으로 숫자로 변환할 수 있으므로 원본 식별자 분석은 JSON을 사용하세요.

## 수치 해석

`authorize.access_denied`는 최종 로그인 실패만 기록한 이벤트가 아닙니다. 예를 들어 `MEMBERSHIP_REFRESH_REQUIRED`는 마지막 Discord 역할 확인이 오래되어 새 인증이 필요하다는 뜻입니다. 자동 SSO에서 `login_required`를 받고 일반 OAuth 로그인으로 진행한 뒤 성공해도, 중간 상태는 기존 거부 기록에 남습니다. `SEASON_ROLE_MISSING`과 구분해야 합니다. 기존 기록은 삭제하거나 바꾸지 않습니다.

현재 문제 필터의 저장 이벤트는 `authorize.access_denied`, `discord.login.access_denied`, `discord.login.error`입니다. 본인 확인 전에 발생한 오류는 사용자 ID가 없을 수 있습니다. 서비스 자체 오류, AUTH에 도달하지 않은 요청, 모든 OAuth 취소·`/token`·`/me` 실패를 완전히 포괄하는 장애 목록은 아닙니다.

## API

`GET /admin/api/access/:clientId/history`는 `nakwol-connect-admin` 토큰과 AUTH 운영 권한을 요구하며 `Cache-Control: no-store`를 반환합니다.

쿼리: `kind=problems|refresh|failures|denied|errors|all`, `since`/`until`(epoch ms), `discord_id`, `limit`(1~200, 기본 50). `denied`/`failures`는 재확인 필요를 제외합니다. 다음 페이지에는 반환된 `next_cursor.created_at`/`id`를 `before`/`cursor_id`로 함께 보내고 처음 받은 `filter`를 유지합니다. `summary=0`은 후속 페이지에서 중복 집계를 생략합니다. 정렬은 `(created_at DESC, id DESC)`입니다. 기존 지원 조치 API와 `/admin/api/apps/:clientId/events` 응답 계약은 유지합니다.

## 복구 여부와 현재 차단 사용자

이용 통계는 역할·재인증 확인 필요, 권한 거부, 인증 오류를 분리합니다. 기존 `summary.denied`는 호환성을 위해 원본 거부 이벤트 수를 유지하며, 새 `failure_summary`를 화면에 사용합니다. 과거 로그의 타입·상세·시각은 수정하지 않습니다.

사용자 목록은 `/admin/api/access/:clientId/issues?status=unresolved|blocked|refresh|recovered|all`을 사용합니다. 기본 UI는 `unresolved`(마지막 거부 뒤 같은 서비스의 성공 미확인)입니다. 현재 AUTH 권한의 차단은 `blocked`, 현재 역할·재인증 확인 필요는 `refresh`로 구분합니다. `recovered`는 마지막 거부 이후 성공한 이력이며 이후 권한 회수로 지금은 차단될 수도 있습니다. 각 행은 최신 거부/성공 시각, 현재 판정, 복구 이력을 함께 표시합니다. 다른 서비스의 성공으로 해결 처리하지 않습니다.

현재 판정은 공통 권한 진단 함수를 사용합니다. 한 요청에 후보 최대 25명을 검사하며, 상태 필터에 맞는 사람이 첫 후보 페이지에 없어도 커서가 진행되고 UI는 나머지 후보를 이어 검사합니다. 전체 후보를 확인하기 전에 '해당 사용자 없음'으로 표시하지 않습니다. 이전의 필터 없는 API 기본값은 `all`로 유지합니다.

성공 미확인은 계속 차단됨의 증명이 아니고, 현재 AUTH 허용도 소비 사이트의 자체 오류나 네트워크까지 검증한 것은 아닙니다. 사용자 ID가 없는 인증 오류는 전체 이력 화면에 보존하며 임의로 특정 사용자와 연결하지 않습니다.

이 변경은 운영자 조회 화면과 읽기 API에만 적용됩니다. 사이트 게이트·SDK·로그인 정책·세션 TTL·권한은 변경하지 않으므로 소비 사이트의 SDK 재설치는 필요하지 않습니다.
