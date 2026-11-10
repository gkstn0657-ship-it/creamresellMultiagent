# KREAM 6개 에이전트 실행 계약

구현 위치는 `renew/Cream`. 기존 `run-all.mjs`가 6개 역할을 순서대로 실행한다. 계산·필수값·후보 승격은 규칙 엔진이 담당하고, 애매한 행의 추가 AI 감사는 Codex CLI 옵션으로 실행한다. 에이전트 정의는 `renew/.claude/agents/`와 `renew/.codex/agents/`에 각각 6개씩 있다. 두 폴더는 같은 역할의 환경별 정의이며 서로 다른 12개 에이전트가 아니다.

| 번호 | 역할 | 구현 | 결과 |
|---|---|---|---|
| 1 | 오류 관리자 | agents-incidents.mjs + 기존 watchdog | incident.json |
| 2 | 옵션·실구매가 검증 | agents-offers.mjs | verified-offers.json |
| 3 | 대체 판매처 탐색 | agents-offers.mjs | fallback-results.json |
| 4 | 최종 감사·위험 평가 | agents-audit.mjs, agents-llm.mjs | audit.json, agent-llm.json |
| 5 | 판매자 증빙 검증 | agents-sellers.mjs | seller-checks.json |
| 6 | 성과 추적·기준 개선 | agents-outcomes.mjs | outcomes.json, calibration-report.json |

## 실행

프로젝트 `renew/Cream`에서 실행한다.

```powershell
# 기존 수집부터 최종 감사·엑셀까지. 릴레이와 확장이 필요하다.
node kream-tools/run-all.mjs kream-runs/<새 실행폴더>

# 최종 감사에 GPT-6.1 Sol High 추가. Codex CLI 로그인 및 모델 접근이 필요하다.
node kream-tools/run-all.mjs kream-runs/<새 실행폴더> --agents-llm

# 기존 덤프 재생: 사이트 접속·LLM 호출 없음. 원본이 아닌 사본 폴더 권장.
node kream-tools/run-all.mjs kream-runs/<사본> --replay --skip-kream

# 수집 없이 구매 제안·대체 작업 계획만 생성
node kream-tools/agents-run.mjs kream-runs/<실행폴더> prepare

# 수집 없이 기존 결과 재감사. 기존 기준 결과는 final-legacy.json에 보존된다.
node kream-tools/agents-run.mjs kream-runs/<실행폴더> finalize
node kream-tools/agents-run.mjs kream-runs/<실행폴더> finalize --llm

# 장애 진단 기록
node kream-tools/agents-run.mjs kream-runs/<실행폴더> incident

# 검증
node --test kream-tools/tests/agents.test.mjs
node kream-tools/preflight.mjs
```

`--agents-llm`은 모델을 `gpt-6.1-sol`, 추론을 `high`로 고정한다. 실행 파일 자동 탐색이 안 되면 `CREAM_CODEX_EXE`에 codex.exe 절대 경로를 지정한다. CLI 인자는 shell 없이 전달한다. 한 호출은 기본 45초, 한 실행은 최대 5회, 한 묶음은 최대 8행이며 총 입력 데이터는 기본 20,000자 이하다(토큰 수와 다름). 필수 규칙 검증은 AI 호출 없이도 실행된다. AI 오류·시간 초과·출력 누락·예산 초과 시 해당 행은 사람 검토로 보낸다. AI는 추가 보류·제외만 할 수 있고 후보 승격·점수 변경을 할 수 없다.

## 공통 식별자와 근거

판매처 URL의 의미 있는 경로·쿼리를 유지하고 추적 파라미터만 제거한 후 `상품 ID + URL 해시`를 제안ID로 쓴다. 옵션ID는 `제안ID + 정규화 사이즈 해시`다. 대체 작업 ID는 `N<상품ID>-<URL해시>-prod`로 기존 확장의 안전한 옵션 탐색을 재사용한다. 동일 상품의 여러 판매처를 따로 검증·보관하고 엑셀에서도 판매처 제안이 다르면 합치지 않는다.

수집시각은 덤프의 `at`만 사용한다. 파일 복사·재생 시각이나 파일 수정시각으로 대체하지 않는다. 상대 거래일도 원래 덤프의 한국 시각을 기준으로 해석한다. 기본 유효기간은 가격·재고·시세 10분, 판매자 정보 24시간이다. 판매자 캐시는 원문 또는 운영자 근거가 바뀌면 즉시 무효다. 시세는 같은 사이즈의 관측된 최근 30일 체결 3건 이상에서 계산하며, 사이즈 혼합 시세는 후보 승인에 쓰지 않는다.

`agent-evidence.json`은 운영자가 원문을 대조해 확인한 값이다. `agent-offers.json`에서 제안ID를 찾고 `agent-evidence.example.json`을 참고한다. 모든 인용은 해당 덤프 파일명·필드·실제 포함된 원문과 일치해야 한다. 옵션 원문에는 사이즈와 해당 가격이 함께 있어야 한다. 무료 배송도 원문 근거를 남긴다. 예시 데이터는 자동 승인용 기본값으로 로드되지 않는다.

`agents-extract.mjs`는 기존 대형몰 수집 빈도 순으로 머스트잇·SSG·트렌비의 제한된 증빙 추출을 지원한다. 명시적인 옵션·단가, 조건 없는 배송비, 별도 판매자 정보 패널만 읽으며 플랫폼 푸터를 판매자로 채택하지 않는다. 확장은 수량을 늘리기 전 수량 1의 선택 옵션 행에서 `offerText`를 저장한다. 패널·가격·조건이 모호하면 계속 사람 검토에 남는다. 결과는 `auto-evidence.json`에 기록하고 운영자가 확인한 `agent-evidence.json`의 명시적인 필드가 우선한다. 확장 변경을 반영하려면 Chrome 확장 관리에서 새로고침이 필요하다. 과거 덤프에 없는 정보를 새로 만들어 채우지 않는다.

상품별 기본 1곳과 대체 3곳을 기존 검색 결과에서 순서대로 확인한다. 모든 필수 검증을 통과한 양수 마진 제안을 찾거나 한도에 도달하면 탐색을 끝낸다. 재생 모드는 미확인 링크를 대기 작업으로 기록하고 방문하지 않는다. `--naver-api --replay`도 저장된 n-cards.json만 사용한다. AI 감사 후 출력 직전에 유효기간을 다시 확인한다.

네이버 쇼핑 검색 API는 2026-07-31에 종료되었고 API HUB 대체 서비스도 없다([공식 공지](https://developers.naver.com/notice/article/32530)). 라이브 실행의 `--naver-api`는 기존 페이지 수집 경로로 연결한다. `naver-api.mjs --fixture`는 저장 응답 변환만 수행하며, 라이브 모드는 인증정보를 읽거나 요청하기 전에 종료 코드 4로 중단한다. 페이지 수집도 실제 브라우저·확장이 연결되어 있어야 실행되며, 소스 접근이나 재고 검증이 성공했다는 의미가 아니다.

KREAM 목록 수집은 사용자 확인 주소의 `sort=popular_score`를 사용한다. `collect-ids.mjs <실행폴더> jobs <키워드 또는 KREAM 카테고리 URL>`로 준비하며, 카테고리 경로와 기존 필터를 유지한다. 화면 인기순 선택도 별도로 확인한다. `extract`는 popular_score URL·화면 선택 기록·관측시각이 모두 있어야 ID를 기록한다. 별도 REST API로 호출하는 기능은 아니다.

## 비용 규칙

실행폴더에 선택적으로 `agent-policy.json`을 둔다. 예시는 `agent-policy.example.json`이다. 기존 수수료율 5%, 발송비 3,000원은 초기 추정값이며 기본 `costPolicyConfirmed`는 false다. 운영자가 실제 적용되는 수수료·비용을 확인하고 출처·버전을 기록한 뒤 true로 바꿔야 후보 승격이 가능하다. 판매가 중앙값으로 계산한 예상 이익은 실제 구매입찰가나 정산 이익이 아니다. 확인하지 않은 정책을 확인 완료로 바꾸지 않는다.

## 성과와 재개

`outcomes.json`은 당시 결과의 모의 스냅샷을 보존하며 같은 내용의 재실행은 중복 저장하지 않는다. 7일·14일 후 재관측할 대상을 `due`에 남긴다. 후속 수집을 예약하거나 관측값을 자동 생성하는 기능은 포함하지 않는다. `outcome-events.json`에 별도 관측·실거래·독립 검토 결과를 입력하면 다음 감사 실행에서 반영한다.

```json
[
  {"eventId":"review-001","optionId":"실제 옵션ID","snapshotId":"outcomes.json의 당시 스냅샷ID","kind":"review","at":"2026-11-08T03:00:00Z","valid":true,"source":"독립 수동 정답표 행 번호"},
  {"eventId":"settlement-001","optionId":"실제 옵션ID","kind":"actual","at":"2026-11-08T03:00:00Z","settlement":180000,"purchaseCost":120000,"extraCost":3000,"source":"실제 정산 명세 식별자"}
]
```

실현 이익은 실제 정산액-매입원가-추가비용이다. 같은 이벤트ID에 다른 값을 입력하면 충돌 오류로 중단한다. 이벤트별로 실제 거래 한 건을 나타내는 고유 ID를 사용한다. 정확도 분모에는 독립 검토된 후보만 넣고, 검토된 보류·제외에서 놓친 유효 후보 수도 별도 집계한다. 기준은 자동 변경하지 않는다.

같은 실행폴더는 `.cream-run.lock`으로 동시 실행을 막는다. 죽은 프로세스의 잠금만 회수한다. 단계·덤프·작업 ID를 재사용해 실패 위치에서 이어간다. STOP은 해제하지 않는다. `final-legacy.json`은 기존 판정, `final-all.json`은 새 감사 결과다. 원문을 새로 확인해야 할 때는 새 실행폴더로 수집한다.

AI 입력은 옵션ID·사유 코드·점수·표본 수로 제한한다. 원문 덤프·판매자명·사업자번호·인증정보·URL을 전달하지 않는다. 실제 서비스 소량 검증은 `node kream-tools/agents-model-smoke.mjs <검증출력폴더>`로 실행한다. 완전한 가상 데이터 2행만 전송하며 응답·호출 시간·CLI 제공 토큰 사용량을 기록한다. CLI에는 시스템 문맥 등의 입력 비용이 있으므로 데이터 글자 수를 실제 토큰 수로 간주하면 안 된다. 금액을 제공하지 않으면 임의 환산하지 않는다.

실제 자료 검토 큐는 `node kream-tools/agents-evaluate.mjs kream-runs <검증출력폴더>`로 만든다. 실제 덤프와 실행·판정별 표본을 섞어 100건을 준비하며, 정답 라벨을 자동으로 붙이지 않는다. `review-labels.json`에 `{caseId, expectedVerdict, reviewedBy, reviewEvidence:["원문 확인 근거"]}` 배열을 넣고 다시 실행한다. 독립 검토 전 후보 정확도는 미산출이다. 생성된 관측값과 사람이 확정한 정답을 구분한다.
