# Cream 상품별 Codex 에이전트 팀

## 무신사 → KREAM·POIZON 검토 (2026-11-11)

무신사 인기순 탐색은 저장된 순서와 중복 기록을 유지한다. 동일 매입처의 재고와
최대혜택가를 공유하고 KREAM과 POIZON의 정확한 모델·색상·옵션을 각각 연결한다.
KREAM 매칭이나 양수 마진이 없어도 POIZON을 확인한다. POIZON은 CN 최저입찰,
별도 수수료 카테고리·최소/최대 수수료·세금 설정으로 마진을 계산한다.
열려 있는 동일 상품 표에서 직접 읽은 값과 관측 조건의 계산값을 구분한다.

글로벌/한국 판매자 30일 판매량과 SKU별 일별 차트는 구분해 저장한다. 약식 판매량,
불명확한 사이즈 변환, 다른 매입가로 계산된 표, 재고 0, 입찰 불가 상품은 통과 근거로
사용하지 않는다. 양쪽 판매처의 자료는 같은 상품 판단·독립 검토에 전달하고 한 번만
집계한다. POIZON 전용 상품 ID는 `poizon-<spuId>`다. 중단 전 미예약 대기 패킷은
10분이 지났으면 재조회한 뒤 검토한다.

상품 담당은 Luna/high, 일반 검토는 Luna/medium, adopt 후보 최종 검증은
Sol/high다. 탐색·감지·조율·커맨더는 결정적 코드이며 모델을 호출하지 않는다.

Chrome 확장은 `automation/no1-background/chrome-extension`의 **0.9.1**을
새로고침해야 세션 선택 수정과 POIZON 명령을 실행한다. 메인 소싱 탭의 최상위
프레임만 인증 세션으로 사용하고, 서로 다른 메인 세션이 있으면 중단한다.
`connector:session-status`는 탭/세션 개수와 오류 코드만 반환한다.
토큰은 브라우저 밖으로 반환하지 않는다. 창 열기·탭 전환·클릭은 수행하지 않는다.

검증 명령:
```powershell
node --test automation/no1-background/*.test.mjs automation/agent-team/*.test.mjs automation/agent-team/live-dashboard/*.test.mjs
```
이 검사는 계약·재시도·계산·옵션 연결·패킷/재개·AI 검토 경계의 자동 검사다.
인증된 No1 실조회와 실제 상품 판단의 완료 여부는 별도로 확인해야 한다.

새 PC 연결·인증·기존 작업/DB를 변경 없이 검사하려면
`node automation/agent-team/preflight.mjs`를 실행한다. `localReady`는 로컬 전제만
뜻하며 실상품 전체 흐름 검증은 별도다. `dotPrerequisitesReady`는 설정 파일의 준비
여부이고 `dotReady: null`은 원격 왕복 미검증이다. 새 상품 작업이나 DB를 만들지 않는다.
현재 개발 작업 상태는 [작업 현황](../../docs/WORK-STATUS-20261110.md)에 기록한다.

배치 재개는 완료된 판단의 원래 패킷을 보존한다. 10분 지난 근거의 갱신은 미완료 상품에만
적용한다. 수집 명세는 해시별 불변 스냅샷을 참조하므로 갱신 도중 중단돼도 원래 수집 범위로
재개할 수 있다. 재사용한 완료 결과는 `reused: true`이며 새로운 시점의 상품 재평가를 의미하지 않는다.

## Dot 안의 관리 화면 (2026-11-10)

사용자 요청에 따라 별도 로컬 대시보드 대신 **Dot/ChatGPT 대화 내부 MCP App**을 구현했다.
Dot에서 `@Cream 상품 관리`를 선택하고 `관리 패널 열어줘`라고 요청한다.
대화 패널과 사이드바 진입점을 선언했다. 실제 호스트의 렌더링 지원은 사용자 화면 확인과 구분해 기록한다.

사용자 실확인: Dot은 `cream_open_panel`을 호출하고 성공 답변을 했지만 화면이 표시되지 않았다.
운영 로그에서 실제 `/mcp` 호출과 결과 반환을 확인했으므로 인증/PC 통신과 화면 표시를 구분한다.
UI v2에는 SDK 호환 키 `ui/resourceUri`, 명시적 표시 모드, 출력 스키마, UI 전용 준비 신호를 추가했다.
`cream_open_panel` 결과는 `render_requested / displayVerified:false`이며, 도구 성공만으로 '열렸다'고 답하지 않도록 명시한다.
`cream_connection_status.ui`는 화면 리소스 전달과 클라이언트 준비 신호를 구분한다. 다른 클라이언트의 신호가 이 Dot 대화의 화면 표시를 증명하지는 않는다.
최종 Dot 렌더링은 여전히 사용자 실확인 대상이다. 일반 ChatGPT의 MCP Apps 지원을 Dot 전용 대화의 지원 보장으로 해석하지 않는다.

UI v2 배포 후 사용자 재확인도 실패했다: Dot이 글로만 응답하고 화면은 보이지 않는다.
마지막 진단에서는 PC 연결 정상, 등록 시 HTML 읽기 기록은 있지만 새 `cream_open_panel` 호출 시각과 UI 준비 신호는 없다.
따라서 현재 상태는 **Dot 본대화 UI 통합 미완료**다. 도구 등록/템플릿 조회를 화면 표시로 주장하지 않는다.
Dot 클라이언트의 지원 여부 또는 호출 경로를 독립적으로 확인할 수 있을 때까지 추측성 수정과 같은 재시도 요청을 반복하지 않는다.

- 본인 전용 원격 MCP: `https://cream-dot-control-20261110.dewy-squid-3972.chatgpt.site/mcp`
- 원격 플러그인 ID: `plugin_asdk_app_sites_ad9fcec1b310819197d344d96d0f0490`
- 원격 서버 소스: `dot-host/`. Sites의 본인 전용 인증 및 OAuth 경계를 유지한다.
- UI: `panel-ui/`. 외부 웹 대시보드 주소로 이동하지 않고 MCP Apps 브리지로만 데이터를 주고받는다.
- 로컬 연결: `remote-bridge.mjs`. PC에서 원격 서버로 나가는 연결만 사용하며, 인바운드 포트를 열지 않는다.
- 실행: `start-dot-bridge.ps1`은 숨겨진 Node 프로세스를 시작한다. PC가 꺼지면 연결이 끊긴다. OS 자동 시작은 추가하지 않았다.
- 인증 정보는 저장소 밖 `%LOCALAPPDATA%/CreamDotBridge/connection.json`에 현재 사용자 전용 ACL로 저장한다. 로그·화면·Git에 넣지 않는다.
- 로컬 MCP 등록 `cream_team`은 기존 실행기용으로 유지한다. 검증용 로컬 UI 플러그인은 원격 연결로 교체했으므로 Dot용과 혼동하지 않는다.

화면은 상품별 판단·쿠폰/마일리지 원자료·가정 손익·미확인 항목·에이전트/검증 기록을 표시하고 시작·중단·재개·추가 지시를 제공한다.
화면 조회/5초 갱신은 AI를 호출하거나 No1을 조회하지 않는다. 저장된 상품 자료만 읽는다.
실행 명령은 등록된 제어 도구만 허용한다. PC 연결이 없으면 신규 실행을 큐에 남기지 않는다.
명령은 한 번만 가져가며, 응답 유실 시 완료로 꾸미거나 자동으로 재실행하지 않는다.
큐 등록·중단 요청·실제 종료 상태를 화면에서 구분한다.

검증: `kream-runs/dot-panel-verification/`의 `verification.json`과 `remote-verification.json`.
독립 브라우저에서 실제 MCP Apps AppBridge로 렌더링·조작했고, 버튼 실행 시험의 작업자는 합성 시험이다.
실상품 저장 결과 읽기, 실제 원격 서버↔PC 왕복, native Dot OAuth/화면 렌더링은 각각 별도 항목이다.
서비스 인증으로 `/mcp`의 OAuth를 우회하지 않는다. `/bridge/check`는 본인용 서비스 접근+별도 키로 보호된 읽기 전용 진단 경로다.

개발 검증:
```powershell
node --test automation/agent-team/panel.test.mjs automation/agent-team/control.test.mjs automation/agent-team/batch.test.mjs automation/agent-team/team.test.mjs
node --test automation/agent-team/dot-host/worker.test.mjs
node automation/agent-team/verify-remote-panel.mjs
```

사용자 요구: **N개 상품 정보를 먼저 취합 → 상품별 정보 묶음 생성 → 각 묶음을 AI가 판단 → 결과 취합**.
같은 KREAM 상품의 판매처·옵션은 한 상품 묶음에 포함한다. 단순 수집·중복 제거·저장·금액 계산은 코드가 담당한다.
상품 채택·보류·제외는 Codex가 결정하며, 기존 파이프라인의 수익률 임계값이나 화면 확인 조건을 새 판단 경로에 적용하지 않는다.

## 실행 구조

- Dot: 상품 범위와 목표를 정하고 `cream_team` MCP로 시작·상태 확인·추가 지시·중단·재개.
- 수집기: No1의 기존 인증된 백그라운드 연결에서 원자료를 수집. 모든 N개에 정보 또는 수집 실패 사유가 생기기 전에는 상품 판단을 시작하지 않는다.
- 상품별 담당: Codex CLI의 지속 세션 하나가 상품 하나를 책임진다. 원자료를 읽고 계산 도구를 호출하며, 결론을 바꿀 만한 정보가 부족할 때만 추가 조사한다.
- 독립 검증: 별도 Codex 세션이 원자료를 직접 읽고 **판단 제안의 내용까지** 확인한다. 검증 후 제안을 바꾸거나 근거가 바뀌면 기존 검증 ID를 재사용할 수 없다.
- 결과 취합기: AI의 판단을 그대로 모은다. 미확인 자료, 가정 계산, 실상품/재생/합성 시험을 구분하며 구매 기능은 제공하지 않는다.

`codex app-server`의 thread/turn 및 동적 도구 호출을 사용한다. 에이전트가 다음 행동을 선택하며 호스트가 고정 단계 JSON을 요구하지 않는다.
특수 분석이 필요한 경우 Codex의 실제 하위 에이전트를 사용할 수 있다. 하위 에이전트에는 원자료 전용 `cream_evidence` MCP를 제공한다.
설치된 CLI에서는 동적 도구가 하위 에이전트에 그대로 전달되지 않는 것을 실시험으로 확인했기 때문에 별도 읽기 전용 MCP를 사용한다.

## 모델과 호출 비용

| 작업 | 실행 주체 |
|---|---|
| 수집·병합·중복 제거·저장·산술 | 코드/MCP, 모델 호출 없음 |
| 상품별 수익성·채택 판단 | GPT-6.1 Sol / medium |
| 필요한 보조 분석 | GPT-6 Luna / high |
| 일반 독립 검증 | GPT-6 Luna / high |
| 채택 후보, 복잡한 근거, 재검증 의견 충돌 | GPT-6.1 Sol / high |

처음부터 상품마다 여러 전문 에이전트를 생성하지 않는다. 상품 판단은 기본 2개씩 병렬로 실행한다.
No1 연결은 요청 하나씩 처리하므로 초기 수집은 순차 처리한다. 계정의 모델 접근 실패나 사용량 제한을 성공으로 바꾸지 않는다.
Codex의 기존 계정 인증을 사용하며 별도 API 키를 복사하거나 추출하지 않는다.

## 도구

등록명 `cream_team`, 실행 파일 `control-mcp.mjs`:

- `cream_open_panel`: 대화 내부 상품 관리 화면 열기.
- `cream_panel_data`: 화면 갱신 및 상품 상세 원자료 읽기. 모델/수집 호출 없음.
- `cream_work_start`: 새 작업을 지시한 사용자가 정한 상품 수량과 원래 지시를 기록. 수량이 없으면 Dot이 먼저 묻는다. 수집은 시작하지 않는다.
- `cream_work_stop`: 작업 범위를 닫고 연결된 배치에 중단 요청.
- `cream_batch_start`: 확인된 작업 범위 안에서 최대 5개 상품을 수집한 다음 판단 시작. `concurrency` 기본·최대 2.
- `cream_batch_status`: 실행 상태/상품별 결과 확인. `runId` 생략 시 실행 목록.
- `cream_batch_steer`: 실행 중인 상품 담당에 후속 지시. 큐 등록과 실제 전달을 구분한다.
- `cream_batch_stop`: 신규 작업 중단, 활성 판단에 중단 요청, 상태 보존.
- `cream_batch_resume`: 명시적 재개 요청. 원래 상품 범위와 패킷 무결성을 검증한다.

Dot용 원격 플러그인은 작업 범위·배치 제어 도구와 `cream_connection_status`, UI 전용 `cream_panel_ready`를 제공한다. 원격 연결 상태 조회 역시 AI를 호출하지 않는다.

Dot은 이 도구들을 볼 수 있는 연결된 로컬 Codex 작업을 통해 조율해야 한다.
**로컬 MCP 등록·실행은 검증 대상이고, Dot 클라우드의 호출 연결·자동 재호출은 별도 실검증 대상이다.**
도구 등록만으로 Dot의 자동 모니터링이나 24시간 운용이 설정된 것은 아니다.

CLI 직접 실행:

```powershell
node automation/agent-team/batch.mjs --seeds=products.json --out=kream-runs/my-product-batch --concurrency=2
node automation/agent-team/batch.mjs --seeds=products.json --out=kream-runs/my-product-batch --resume
```

`products.json`은 아래 객체의 배열이다. 실제 수집에서 확인한 식별자를 사용한다.

```json
[
  {
    "kreamId": "1120286",
    "productUrl": "https://www.musinsa.com/products/7481180",
    "model": "NBNPG41033",
    "color": "(19)BLACK",
    "option": "L(100)"
  }
]
```

## 결과와 중단·재개

- `packets/product-<id>.json`: 상품 정보 묶음. 원자료, 최초 관측 시각, 누락 항목, 내용 해시.
- `collection-complete.json`: N개 취합 완료 기록. 이 기록 이후 개별 AI 판단이 시작된다.
- `judgments/<id>/team-state.json`: 해당 상품의 세션, 도구 호출, 계산, 검증, AI 판단.
- `batch-result.json`: 전체 상품 판단 취합. 수집/모델 실패도 상품별로 남긴다.

대화 세션 ID와 원자료를 저장해 이어서 작업한다. 도구 스키마가 바뀌면 저장된 사실을 보존하면서 새 세션으로 이전한다.
`STOP`은 실행 폴더에 남으며 명시적 재개 때 해제한다. 성공한 상품을 임의로 다시 판단하지 않고, 만료된 관측을 새 자료처럼 표시하지 않는다.
No1 창 표시·화면 조작·로그인 창 띄우기로 우회하지 않는다. Chrome의 별도 KREAM 페이지가 로그인 화면으로 이동하면 `KREAM_LOGIN_REQUIRED`로 구분한다.

## 수익성 의미

- 기존 적립금 사용은 현금 지출과 경제적 비용을 구분한다. 신규 적립은 별도 표시한다.
- 최대혜택가는 실결제 확정가로 바꾸지 않는다. 미확인 배송비/수수료를 0으로 채우지 않는다.
- `decision`은 AI가 정한 `adopt / hold / exclude`다. 채택 의견도 조사 후보이며 구매 실행은 없다.
- `readiness`, `unresolved`, 계산의 `classification: scenario`를 함께 읽는다. `confirmedProfit`은 현재 경로에서 확정하지 않는다.
- No1 Connector 0.3.0은 사이즈별 호가, 최근 거래와 판매 수수료·정산 미리보기를 수집한다. 거래 페이지를 끝까지 읽지 못하면 건수는 하한으로만 표시한다.
- `catalog-evidence.json`의 공식 KREAM 상품 페이지 근거는 모델·색상 연결에만 사용하며 웹 검색의 과거 가격을 현재 시세로 사용하지 않는다. 등록되지 않은 상품은 AI가 별도로 신원을 조사해야 한다.
- 쿠폰·마일리지·결제수단 할인은 조건별로 보존한다. 원천 갱신 시각, 실제 결제 적용 자격과 배송비는 별도 확인 대상이다.

## 검증과 남은 연결

초기 검증 기록은 `kream-runs/agent-team-bootstrap/validation.json`, 최신 준비 검증은 `kream-runs/agent-team-readiness/validation.json`에 모은다.
단위 테스트, 실제 Codex 추론을 사용한 합성 N개 시험, 실제 상품 조회, 창/포커스 관찰을 구분한다.
합성 시험의 이익 수치는 실상품 수익이 아니다.

2026-11-10 실제 검증: `batch-2421c619-28f8-4bca-a38b-4986bde41b3b`에서 같은 모델의 BLACK/L 및 CHARCOAL/M 두 KREAM 상품을 먼저 모두 수집한 뒤 별도 Codex 담당·검토 세션으로 판단했다. 두 상품 모두 완료·제외다. 이는 두 상품에 대한 검증이며 전체 시장의 수익 상품 부재를 뜻하지 않는다.

Windows 파일 잠금으로 저장이 실패하는 경우 제한된 재시도 후 원자적으로 교체한다. CLI 세션 생성 직후 중단되어 rollout이 없으면 저장된 근거를 유지해 담당 세션을 복구한다. 완료 상품은 다시 판단하지 않으며 실제 중단된 두 번째 상품 복구를 확인했다.

## Dot 자율 후속 실행

### 2026-11-10 순환 탐색 적용

새 탐색 명령은 `cream_work_start(targetProducts=N, userInstruction=실제 지시, requestId=고유 지시 ID)` 다음 `cream_explore_start(workId)`를 호출한다. PC가 해당 N개 범위의 배치를 자동으로 순차 실행한다. Dot은 완료 이벤트에서 상태와 결과를 읽으며 별도 상품 선택이나 다음 배치를 추가하지 않는다. 상품별 수익성 판단·독립 검토 AI는 유지되지만 탐색·분류·순서 결정에는 AI를 호출하지 않는다.

`cream_discovery_status`는 다음 목록 커서·카테고리·대기 수량·자료 범위·작업 진행을 반환한다. `kream-runs/agent-teams/discovery/discovery.sqlite`가 사용자 지시 사이의 진행 위치와 중복 방지 원본이다. 조회는 No1 Connector 0.4.0의 읽기 전용 인기순 목록을 사용한다. 분류는 이름 규칙이며 공식 분류로 검증되지 않았고 모호한 항목은 미분류 대기열에 포함한다. 누적 거래량을 최근 거래량으로 바꾸지 않는다.

무신사 수익성 탐색에서 재고·양의 관측 마진·최근 판매 근거와 독립 검토를 모두 통과한 상품은 런타임 루트의 `qualified-products.json`에 상품 기준으로 영구 누적한다. 사람이 바로 열어 볼 수 있는 링크 목록은 같은 위치의 `qualified-products.md`다. 배치가 끝날 때마다 과거 작업 전체를 다시 병합하므로 같은 상품은 중복되지 않고, 이전 작업 폴더가 목록에서 빠져도 이미 등록된 항목은 삭제하지 않는다. 이 두 파일은 계정별 로컬 런타임 자료이므로 Git에는 포함하지 않는다. 2026-11-12 종료 시점의 10개 상세 스냅샷은 [QUALIFIED-PRODUCTS-REPORT.md](./QUALIFIED-PRODUCTS-REPORT.md)에 보존한다.

`cream_work_stop`으로 중단한다. 사용자가 이어 하기를 요청하면 같은 workId에 `cream_explore_start(resume=true)`를 사용한다. 실패·중단으로 예약된 상품도 같은 배치에서 재개하며 목표 N을 다시 차감하지 않는다. 여러 번 N개를 요청하면 기존 커서와 카테고리 차례에서 이어지고, 이미 배정한 KREAM ID는 다시 배정하지 않는다. 원천 목록을 소진하면 소진 상태를 보고하며 기존 항목을 임의로 반복하지 않는다.

현재 구매처 자동 옵션 매칭과 혜택 조회는 무신사 경로를 지원한다. 추가로 29CM 공개 검색 및 상품 JSON-LD에서 상품 ID·품번·금액이 확인된 견적을 source_quote로 수집한다. 29CM의 옵션별 재고·결제 혜택은 미확인으로 남긴다. 명확한 품번·색상·옵션 일치만 offers로 연결하고 나머지는 자료 부족으로 남긴다. 후보 한 개는 KREAM ID 하나이며 수집 실패·구매처 미확인도 이 작업 범위에 포함해 별도로 보고한다. N개 모두 수익성 판단 가능하거나 매입 가능한 상품을 보장하지 않는다. 상세 규칙과 검증 기준: [DISCOVERY-PLAN.md](./DISCOVERY-PLAN.md).

2026-11-10 구매처/지연 수정: 무신사 검색의 정상 307 이동은 같은 HTTPS 호스트·경로·검색어 안에서 최대 3회만 따른다. 검색 실패는 구체적인 코드로 남긴다. `source_quote`는 품번이 확인된 구매처의 재고·혜택 원자료이며 `offers`는 색상·사이즈까지 연결된 제안이다. 옵션 매칭 실패가 구매처 원자료를 버리지 않는다. 단일 사이즈 축 상품의 색상은 판매자 상품명의 명시적인 색상/정확한 품번 구간으로만 연결하고 US/KR 사이즈 변환을 추정하지 않는다. 심층 수집은 첫 검색 페이지·최대 3개 구매처·최대 3개 일치 옵션으로 제한하고 자료 범위를 표시한다. 구매처 견적이 전혀 없으면 상세 거래 페이지 수집을 보류한다. `collection_summary`를 담당 AI와 검토 AI가 같은 원자료로 읽는다.

운영 판단은 한 묶음·동시 상품 2개를 유지한다. 그 판단 중 다음 최대 5개 묶음의 수집만 선행한다. 선행 묶음도 먼저 N 범위에서 예약하며 중단·오류·재개 시 같은 상품과 예약을 유지한다. 각 묶음 내부의 전체 수집 완료 후 AI 판단 시작 조건은 유지한다. 로컬 No1 요청은 같은 작업 프로세스의 공유 FIFO로 직렬화된다. `prefetching`/`prefetched` 상태는 완료 이벤트가 아니다. 선행 수집이 실패하면 현재 판단을 보존한 뒤 작업을 멈춘다.

아래 이벤트 기반 후속 설명 중 새 배치 선택은 수동 seeds 작업에 해당한다. 순환 탐색 작업에서는 PC 실행 루프가 후속 배치를 관리하며 Dot은 중복 시작하지 않는다.

원격 MCP는 `cream.batch.finished` 이벤트를 제공한다. 실제 작업의 완료·중단·오류만 발행하고 합성 테스트는 제외한다. 2026-11-10 04:33 KST에 실제 완료 이벤트 1건 전달, Dot의 배치 결과·원자료 조회 및 대기 판단을 확인했다.

사용자의 최신 정책: **하루 100개 고정 한도는 없다. 새 작업 지시마다 상품 수량을 묻고, 이미 수량을 지정했다면 그대로 등록한다.** `cream_work_start`는 실제 사용자 지시와 수량을 보존한다. Dot은 그 범위 안에서 한 번에 최대 5개·동시 판단 2개·활성 배치 1개로 자율 진행한다. 잔여 수량이 없으면 완료를 알리고 다음 사용자 지시를 기다린다. 새 범위를 스스로 만들지 않는다.

`cream_batch_status`를 `runId` 없이 호출하면 작업 수량, 시작 예약 수량, 남은 수량과 진행 중 배치가 나온다. `eventId`를 함께 보내면 그 이벤트의 후속 실행 이력을 확인할 수 있다. 후속 시작에는 `triggerEventId`를 전달한다. 서버는 이벤트별 동일 실행 ID, 작업 수량 제한, 원자적인 시작 예약으로 중복·초과 실행을 막는다. 실패한 시작도 예약을 보존하므로 미확인 실행을 새 작업으로 중복 시작하지 않는다.

`remote-bridge.mjs`의 알림 전송은 명령 처리와 독립적이다. 느린 콜백이 명령 확인을 막지 않으며 전송 실패를 작업 성공으로 기록하지 않는다. 서명된 콜백 검증, 구독 만료·갱신, 제한된 재전송을 지원한다. `cream_connection_status.events`에서 활성 구독과 전달 상태를 확인한다.

구독 오류 진단: `events.lastSubscriptionAttempt`는 마지막 실제 구독 요청의 성공 여부, 오류 분류, 콜백 호스트와 HTTP 상태만 남긴다. 서명 키·콜백 경로·쿼리는 저장하거나 출력하지 않는다. `ok:true` 뒤에 활성 구독이 0이면 클라이언트의 후속 취소 여부도 확인한다. HTTP 200만으로 JSON-RPC 구독 성공을 판정하지 않는다.

Cloudflare Workers는 `redirect:'error'`를 지원하지 않아 요청 생성 단계에서 TypeError가 발생한다. 콜백은 `manual`로 보내고 3xx를 실패로 처리하여 리디렉션을 따라가지 않는다. 보호된 `/bridge/event-runtime-check`는 실제 호스팅 런타임에서 이전 오류와 수정된 서명 요청 생성을 재현하며 외부 콜백을 보내지 않는다. 이 시험은 Dot 실제 구독 시험을 대체하지 않는다.

Dot 자체가 `events/subscribe`로 콜백과 서명 키를 발급해야 한다. 이 PC 연결 코드나 진단 경로로 Dot 구독을 대신 만들 수 없다. **서버 배포·모의 테스트·콜백 수신과 Dot의 실제 후속 판단/도구 호출은 각각 구분해서 검증한다.** 구독이 없으면 자율 후속 실행은 활성화되지 않은 상태다.

기존 `automation/agentic` 소스는 보존했다. 기본 운영 설정은 `dot-agent-team`으로 전환했고, 이전 `automation/loop.mjs`와 `commander start`는 이제 자동 수집을 시작하지 않는다. 새 운영 경로는 사용자 범위 지정 → Dot 작업 등록 → 상품별 Codex → 완료 이벤트 → Dot 판단이다. 일일 자동 탐색은 설정하지 않으며 장기 구독 갱신은 별도 관찰 대상이다.

참고: [MCP Events 공식 문서](https://developers.openai.com/plugins/build/mcp-events). 관리 UI 표시 시험은 사용자 요청으로 보류되어 있다.

구현 근거: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [하위 에이전트](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Dot 작업 조율](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
