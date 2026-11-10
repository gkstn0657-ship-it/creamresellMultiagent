# No1 백그라운드 연결기

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

```powershell
node --test automation/no1-background/protocol.test.mjs automation/no1-background/bridge.test.mjs automation/no1-background/extension.test.mjs automation/no1-mcp-prototype/server-stock.test.mjs automation/no1-mcp-prototype/ui-policy.test.mjs
node automation/no1-background/verify-registered.mjs --out=kream-runs/no1-background-20261110/registered-local.json
# Chrome 연결 후 아래 검증은 화면 조회를 실행하지 않는다.
node automation/no1-background/verify-registered.mjs --remote --out=kream-runs/no1-background-20261110/registered-remote.json
```

자동 테스트는 응답 식별자 불일치, 인증 실패, No1 오프라인, 시간 초과, 중복·지연 응답, 로컬 접근 키/출처 확인, 민감 필드 제거, 금지 명령, 기존 UI 차단을 검증한다. Chrome 워커 테스트는 브라우저 API를 모의한 검사이므로 실제 Chrome 설치·실시간 No1 성공을 대신하지 않는다.

단건 조회는 매 요청 전 내부 브라우저 설정을 확인하고, KREAM/무신사 로그인 상태가 맞지 않으면 해당 조회를 차단한다. 화면 기반 KREAM 검색은 허용하지 않는다. 현재 남은 검증은 No1 안의 KREAM 로그인 복구 후 시세 확인, 시세 원천 시각·거래량·수익성 파이프라인 연결이다. 성공한 무신사 재고·혜택 결과만으로 구매를 승인하지 않는다.
