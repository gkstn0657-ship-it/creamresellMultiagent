# No1 백그라운드 연결기

## 표를 열지 않는 단건 참고 후보 조회

`no1_background_reference_lookup({kreamId:"797025",model:"27103207",sourceSize:"230"})`는 지정 후보의 품번을 무신사에서 검색하고, 정확히 일치하는 모델·옵션을 No1으로 조회한 뒤 혜택·시장 자료를 모은다. 품절도 자료로 남긴다. sourceSize는 판매처 표기이며 다른 국가 사이즈와의 대응은 외부 근거로 먼저 확인한다. 시세 로그인 실패는 `partial`로 남기고 성공한 재고·혜택·수수료 설정을 유지한다. 상품 탐색 DB와 N개 작업 범위는 변경하지 않는다.

```powershell
node automation/no1-background/lookup-reference.mjs --kreamId=797025 --model=27103207 --sourceSize=230 --out=kream-runs/reference-797025/autonomous
```

CLI의 종료 코드 0은 수집 완료, 2는 부분 수집/주의 필요, 1은 실행 오류다. 수집 완료는 수익성 승인이나 구매 가능을 뜻하지 않는다. 아래 열린 표 도구는 원본 표시값 대조용이며 이 자동 조회의 필수 단계가 아니다.

## 품절 참고 후보의 원본 마진표 읽기

`no1_background_displayed_schema({kreamId:"797025"})`는 Connector 0.6.0에서 이미 열린 동일 상품 시세표의 마진금·수익률과 매입가·판매 방식·수수료·부가세·거래량을 읽는 로컬 MCP 도구다. 무신사 URL이나 재고 옵션을 요구하지 않는다. 표가 열려 있지 않으면 `available:false`를 반환하며 화면을 열거나 클릭하지 않는다. 품절이어도 참고 분석은 가능하지만 표시값을 실제 수익·구매 가능으로 승인하지 않는다. 기존 MCP 호스트는 도구 목록을 다시 불러와야 새 도구를 볼 수 있다. Dot 원격 상품관리 서버에 새 도구를 배포했다는 뜻은 아니다.

연결 버전 오류는 로컬 `/status`의 `observedConnectorVersion`과 `requiredConnectorVersion`으로 진단한다. 전자는 마지막 연결 확장이 알린 버전이며 인증 성공·현재 연결의 증거와는 별개다. 불일치 상태의 상품 조회 차단은 유지한다.

기준 수립 참고: [797025 UK4 사례](../../docs/reports/20261110-reference-797025-uk4.md).

최신 변경(2026-11-10): **Connector 0.6.0의 인증된 실제 시세표 원본 수집을 검증했다.** 빠른배송 포함 상세 가격, No1 30일 사이즈별 집계와 기준시각, 실제 웹 수수료 설정을 보존한다. 이미 열린 동일 상품 웹 시세표에서는 선택 방식의 마진 표시값을 읽는 경로도 추가했다. 직접 표시값 대조는 사용자 종료 요청으로 미완료다. 구현·CLI·검증 범위는 [마진 결과 연결](../agent-team/MARGIN-REPORT.md)의 최신 변경 절을 참고한다. 이하 이전 검증 기록은 당시 상태다.

2026-11-10: 기존 `no1` MCP에 화면을 사용하지 않는 진단 도구 4개와 단건 상품 검증 도구를 추가했다. **실제 Chrome → No1 원격 연결과 무신사 재고·혜택 조회를 검증했다. KREAM 시세는 No1 내부 KREAM 연동이 로그아웃 상태라 보류 중이다.**

실제 검증 상품은 무신사 7481180, 품번 NBNPG41033, `(19)BLACK / L(100)`이다. 조회 당시 재고 39개, No1 최대혜택가 375,280원, 상품 쿠폰 할인 19,950원(뉴발란스 패션위크 5% 쿠폰), 등급 할인 1,890원, 보유 적립금 사용액 0원, 선할인 적립금 1,880원을 받았다. 이 값은 확정 결제가가 아니다. 판매 시세와 비용 검증이 끝나지 않아 수익상품으로 승인하지 않았다.

해당 단건 시험에서 100ms 간격으로 No1 창을 관찰한 결과 새로 표시된 창 0개, No1으로 포커스 이동 0회였다. 현재 실행 환경에서의 관찰이며 모든 향후 상태를 보장하는 수치는 아니다. 관련 회귀 테스트 121개 통과. 증거는 `../../kream-runs/no1-background-20261110/validation.json`과 `product-probe-2`에 있다.

## 구성

`Codex MCP → 로컬 연결기(127.0.0.1:8871) → Chrome 확장 → 공식 No1 Relay → 실행 중인 No1`

Chrome 확장은 이미 열린 공식 No1 웹 탭에서 로그인 세션을 읽는다. No1 로그인 토큰은 Chrome 안에서만 사용하고 공식 `wss://relay.certi.life/ws/v2`로만 전송한다. 로컬 연결기에는 조회 결과만 전달하며, 토큰·쿠키·비밀번호를 파일이나 로그에 저장하지 않는다. 앱의 암호화 저장소나 Chrome 프로필 파일을 읽지 않는다.

확장은 탭 생성·활성화·탐색·닫기, 창 표시·포커스, 화면 캡처, 마우스·키보드 조작을 하지 않는다. 여러 다른 No1 세션이 발견되거나 로그인 세션이 없으면 오류로 반환한다. 로그인 창을 자동으로 열지 않는다.

## 최초 연결

현재 도구에서는 Chrome 연결 호스트가 제공되지 않아 기존 로그인 세션을 직접 사용할 수 없다. **Chrome 확장 등록과 연결은 사용자가 한 번 진행해야 한다.** 이것은 No1 화면 자동화가 아니라 정상 웹 인증을 Chrome 안에서 사용하는 연결 설정이다.

1. 로컬 연결기 실행: `node automation/no1-background/run-bridge.mjs`. 이미 실행 중이면 추가 실행하지 않는다. 작업 중 자동 시작 프로그램으로 등록하지 않는다.
2. Chrome `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 이 폴더의 `chrome-extension`을 선택한다.
3. PowerShell에서 아래 명령으로 **로컬 연결 코드**를 복사한다. 코드 자체는 화면에 출력하지 않는다.

   ```powershell
   powershell.exe -NoProfile -File "C:\Users\HansuPark\Desktop\Cream\1109renew\Cream\automation\no1-background\copy-pairing-code.ps1"
   ```

4. 확장 `No1 Background Connector`를 열어 연결 코드를 붙여넣고 **연결**을 누른다. No1 웹 로그인 탭은 그대로 둔다.

로컬 연결 코드는 No1 계정 토큰과 다른 임의의 접근 키다. `%LOCALAPPDATA%\CreamNo1Bridge\connection.json`에 저장되며 채팅이나 저장소에 붙여넣지 않는다. 연결 해제 버튼은 확장에 저장한 로컬 키를 제거하고 대기 요청을 중단한다. 사용자가 직접 복사 명령을 실행하면 클립보드 내용이 연결 코드로 바뀐다.

## 등록된 도구

| 도구 | 범위 |
|---|---|
| `no1_background_status` | 로컬 연결 상태. No1 조회를 보내지 않는다. |
| `no1_background_supported_sites` | No1 지원 사이트의 이름과 식별자만 반환한다. |
| `no1_background_musinsa_login` | 무신사 로그인 여부만 반환한다. |
| `no1_background_runtime_settings` | KREAM 브라우저 종류와 혜택 기준 계정 설정 여부만 반환한다. 계정 정보는 제외한다. |
| `no1_background_product_probe` | 상품번호·품번·색상·사이즈를 지정한 단건 재고·혜택·시세 검증. 일부 실패 시 성공한 조회 결과를 보존하고 `queryStatus: partial`로 반환한다. |

기존 화면 조회 도구 3개는 계속 `NO1_BACKGROUND_ONLY_UI_DISABLED`로 차단한다. 조회 실패 시 UI 경로로 넘어가지 않는다. 현재 운영은 `automation/agent-team`의 백그라운드 상품 탐색을 사용한다. 상태의 `pipelineProductQueriesEnabled: false`는 이전 UI 파이프라인을 뜻한다.

Connector 0.5.0은 `/next?wait=20000` 롱폴링으로 명령을 즉시 받고 완료 직후 다음 명령을 기다린다. 3초 타이머는 워커 복구용이다. 요청은 하나씩만 No1에 전달하며 설정·로그인 확인과 응답 검증을 유지한다. `/status.recentTimings`는 최근 30건의 명령명·대기 시간·전체 시간·성공 여부만 기록하며 토큰이나 상품 원문은 기록하지 않는다. KREAM의 `colorway: null`은 정상 미확인 값으로 보존한다.

## 검증

탐색 감시의 전체 코드·담당·복구 규칙은 [`automation/agent-team/ERROR_CODES.md`](../agent-team/ERROR_CODES.md)에 정리되어 있습니다.

```powershell
node --test automation/no1-background/protocol.test.mjs automation/no1-background/bridge.test.mjs automation/no1-background/extension.test.mjs automation/no1-mcp-prototype/server-stock.test.mjs automation/no1-mcp-prototype/ui-policy.test.mjs
node automation/no1-background/verify-registered.mjs --out=kream-runs/no1-background-20261110/registered-local.json
# Chrome 연결 후 아래 검증은 화면 조회를 실행하지 않는다.
node automation/no1-background/verify-registered.mjs --remote --out=kream-runs/no1-background-20261110/registered-remote.json
```

자동 테스트는 응답 식별자 불일치, 인증 실패, No1 오프라인, 시간 초과, 중복·지연 응답, 로컬 접근 키/출처 확인, 민감 필드 제거, 금지 명령, 기존 UI 차단을 검증한다. Chrome 워커 테스트는 브라우저 API를 모의한 검사이므로 실제 Chrome 설치·실시간 No1 성공을 대신하지 않는다.

단건 조회는 매 요청 전 내부 브라우저 설정을 확인하고, KREAM/무신사 로그인 상태가 맞지 않으면 해당 조회를 차단한다. 화면 기반 KREAM 검색은 허용하지 않는다. 현재 남은 검증은 No1 안의 KREAM 로그인 복구 후 시세 확인, 시세 원천 시각·거래량·수익성 파이프라인 연결이다. 성공한 무신사 재고·혜택 결과만으로 구매를 승인하지 않는다.
## 무신사 랭킹 인기순 조회 (Connector 0.7.0)

### 수익 후보 N개를 찾을 때까지 실행 (Connector 0.8.0)

`cream_musinsa_profit_work_start`에 `targetProfitableProducts`, 실제 사용자 지시, 재시도용 `requestId`를 전달합니다. 이는 검토 개수 상한인 기존 `cream_work_start(targetProducts)`와 다른 범위입니다. `musinsa-profit-runner.mjs --root=<작업 기록 경로> --work=<workId>`가 그 범위 안에서 인기순 후보를 수집하고 자동으로 다음 배치를 실행합니다. 원자료·진행·대기 패킷은 작업 기록에 남으며 일반 탐색 DB는 건드리지 않습니다.

Connector 0.8.0은 공식 No1의 읽기 전용 상품 검색에서 제한된 모델/상품명 검색을 허용합니다. 임의 명령·주문·상품 등록을 허용하지 않습니다. 자동 매칭은 구매처 품번과 KREAM 검색의 품번을 정확히 대조합니다. 동일 품번의 등록이 여러 개면 누적 거래량 내림차순, 상품 ID 오름차순으로 하나를 선택하고 다른 등록 ID도 근거에 보존합니다. 이 누적 거래량을 최근 판매량으로 사용하지 않으며 최근 수요는 별도로 검증합니다. 정확히 모델이 일치하며 양쪽에 선택지가 하나뿐인 비숫자 원사이즈 상품은 그 근거를 기록하고 연결할 수 있습니다. 의류의 명시적 `085(XS)` 표기는 `XS`와 연결하며 신발 숫자 사이즈를 임의로 변환하지 않습니다.

독립 검증된 adopt 결과 중 실제 연결된 옵션에 재고·양수 마진·최근 판매량 근거가 있는 서로 다른 KREAM 상품만 목표 수에 포함합니다. 보관/일반/즉시판매 조건은 구분하고, 기준 없이 임의의 최소 마진율을 만들지 않습니다. 목표에 못 미친 채 공개된 랭킹 범위를 소진하면 `source_exhausted`로 보고합니다.

사용자가 명시적으로 중지할 때까지 탐색을 지시한 경우에는 기존 작업에 `cream_musinsa_work_continue(workId)`를 적용합니다. 처음 목표 10개 등의 달성 기록은 유지하지만, 그 숫자에 도달해도 탐색을 끝내지 않습니다. PC의 `musinsa-continuous.mjs`가 랭킹 범위 소진 후 5분 간격으로 새 인기 목록을 확인하며, 이미 처리한 무신사·KREAM 상품은 다시 판단하지 않습니다. KREAM 검색 등 일시적 오류는 동일 요청을 제한된 횟수로 재시도합니다. 계속 실패하면 해당 상품과 랭킹 위치를 보존하고 15분 뒤 다시 시도하며, 실패를 상품 탈락으로 세지 않습니다. 사용자가 `cream_work_stop(workId)`를 호출하면 실행 루프를 멈춥니다. 이 동작은 상품 구매를 실행하지 않습니다.

### Windows 실시간 대시보드

`automation/agent-team/live-dashboard/start-dashboard.ps1`을 실행하면 로컬 서버가 숨겨진 상태로 시작되고 Edge의 독립 앱 창이 열립니다. 작업 기록이 저장된 폴더가 기본 위치와 다르면 `-Root <agent-teams 절대경로>`를 전달합니다. 앱은 2초마다 저장된 수집·AI 판단·독립 검토 기록을 읽고, 연결 오류와 다음 재시도 시각을 표시합니다. 읽기 전용 로컬 화면이며 No1 창이나 계정을 조작하지 않습니다. Windows 바탕화면 바로가기는 현재 PC에서만 생성되므로 다른 PC에서는 이 스크립트를 한 번 실행하면 됩니다.

### 실시간 감시 신호와 담당 역할

`live-watchdog.mjs`가 10초마다 브리지·확장 연결·탐색 실행기·저장된 진행 시각을 읽습니다. 감시 역할이 `heartbeats/monitor.json`에 순번이 있는 신호를 저장하고, 조율자가 `heartbeats/coordinator.json`으로 수신 확인한 뒤 커맨더가 `heartbeats/commander.json`에 담당 역할과 처리 결과를 남깁니다. 확인 전에 중단된 신호는 다음 점검에서 먼저 다시 처리합니다. 이 코드는 내부 상태 분류용이며 No1 또는 KREAM의 실제 HTTP 응답 코드를 뜻하지 않습니다.

| 신호 | 담당 역할 | 처리 |
| --- | --- | --- |
| 200 정상 | 커맨더 | 그대로 계속 실행 |
| 401 로그인/인증 | 인증 담당 | 사용자 조치 필요 알림, 자동 로그인 금지 |
| 404 No1 웹 탭 | 브라우저 연결 담당 | 읽기 전용 재확인 후 복구되면 즉시 재시도 |
| 426 확장 버전 | 확장 담당 | 재로드 필요 알림 |
| 429 제한 | 요청 간격 담당 | 저장된 대기 시간 준수 |
| 500 실행기 종료 | 작업 담당 | 활성 작업이면 제한된 간격으로 재시작 |
| 502 검색 원본 오류 | 원본 담당 | 같은 상품을 보존하고 기존 재시도 유지 |
| 503 브리지/확장 연결 | 브리지 또는 확장 담당 | 로컬 브리지만 안전하게 재시작 가능, 확장 끊김은 알림 |
| 504 장시간 갱신 없음 | 지연 담당 | 진단 기록·알림 |
| 501 미분류 오류 | 진단 담당 | 안전한 오류 코드와 작업 상태를 기록하고 알림 |

오류 전환 시 Windows 알림과 대시보드 작업 기록을 남깁니다. 감시기는 상품 선택이나 매입을 하지 않으며, No1 창을 띄우거나 UI를 조작하지 않습니다. `cream_work_stop` 후에는 감시와 탐색이 함께 끝납니다.

무신사 후보의 판단 기준은 **판매 방식별 마진율·구매 옵션 재고·최근 판매동향**입니다. 랭킹 피드의 `assessmentTool`은 `cream_musinsa_batch_start`를 가리킵니다. KREAM 상품/구매 옵션을 연결한 후 사용자 확인 N 작업 범위 안에서 이 전용 도구를 사용합니다. 도구는 `analysisProfile=musinsa-ranking`을 실행/재개까지 보존합니다. 일반 상품 탐색·판단 경로는 그대로입니다.

후보 선택은 고정 인기순 로직이며, 상품 판단 담당 AI와 독립 검증 AI는 유지합니다. 전용 프로필에서는 저장된 정보만 읽고 추가 수집·탐색 도구와 임의의 조사 에이전트 생성을 사용하지 않습니다. `read_musinsa_signals`가 마진/재고/최근 7일 대비 직전 7일 거래량 및 중앙 거래가격을 제공합니다. 30일 추정량은 실제 체결 집계와 구분하고, 불완전한 범위에서는 증가·감소 판단을 표시하지 않습니다. 계산 결과는 원자료 ID·집계식과 함께 저장되어 독립 검증에 사용됩니다. 통과 마진율·최소 거래량의 수치 기준을 새로 만들지는 않습니다.

이 도구는 **이미 연결된 후보의 판단 실행 경로**입니다. 랭킹 상품의 KREAM 자동매칭이나 랭킹 전용 N개 연속 탐색 루프가 구현됐다는 뜻은 아닙니다. 새 MCP 도구 정의는 레포와 Dot 빌드에 반영되며, 이미 실행 중인 외부 MCP 서비스에는 해당 버전 재시작/배포가 필요합니다.

`no1_background_ranking_feed`는 No1 무신사 랭킹분석 > 랭킹분석의 현재 카테고리·기간·성별·연령 설정을 읽고, `section=all` 목록을 순위 오름차순으로 반환합니다. 카테고리 `000`은 No1의 전체 카테고리입니다. NEW/급상승/일반 상품 키워드 검색을 사용하지 않습니다. 화면 클릭·이동·포커스 변경 없이 조회하며, 화면 설정 자체를 변경하지 않습니다.

정책: `ranking-policy.json`. 현재 설정이 없거나 여러 열린 No1 세션의 설정이 충돌하면 실패하며 임의의 카테고리로 대체하지 않습니다.

```powershell
node automation/no1-background/read-ranking.mjs --limit 5 --out kream-runs/musinsa-ranking/preview.json
```

이 명령은 순위 후보 미리보기입니다. 일반 KREAM 탐색 커서·작업 수량·상품 AI 판단을 진행하지 않습니다. `cream_explore_start`의 일반 탐색 루프와는 별도 경로이며, 랭킹 후보의 매칭·재고·마진 판단은 이후 단계입니다. 매입 가능 여부나 수익성은 순위만으로 확정하지 않습니다.

2026-11-10 실제 인증 연결 검증: Connector 0.7.0, 전체 카테고리/실시간/전체 성별·연령으로 101개 조회. 1위 2235274, 2위 2577899, 3위 7325399(닥터마틴 27103207). 이 검증은 당시 조회 결과이며 최신 순위는 다시 조회해야 합니다.
