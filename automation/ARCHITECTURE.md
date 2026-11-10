# Cream 자동화 구조와 운영 상태

## 목표

매일 최대 500개 KREAM 상품을 탐색하고, Naver 우선 판매처의 동일 모델·색상·사이즈를 비교한다. 실제 매입가, 배송비, KREAM 판매 수수료와 부가 비용, 최근 동일 사이즈 체결, 판매자, 재고를 확인한 뒤 후보만 HTML·엑셀로 낸다. 주문·입찰·자동 구매는 실행 범위에 없다.

## 실행 흐름

Dot이 메인 커맨더다. 연결된 PC의 로컬 Codex 작업으로 `automation/commander.mjs`를 호출해 상태를 확인하고 실행·중단을 지시한다. 수집과 검증은 이 PC의 CLI 프로세스가 수행한다. Dot에 등록할 책임과 명령은 [DOT-COMMANDER.md](DOT-COMMANDER.md)에 있다.

1. `automation/loop.mjs`가 한국 날짜별 실행 폴더를 만들고 20개 검색/카테고리 소스를 전달한다. `STOP` 파일과 실행 잠금으로 반복을 제어한다.
2. 기존 Chrome 릴레이가 인기순 확인 화면에서 상품 ID를 수집한다. 여러 검색 소스의 중복 ID를 제거해 최대 500개를 선택한다. 실제 확보 수가 500개보다 적으면 `under-target`으로 기록한다.
3. 확보한 ID를 5개씩 독립 배치로 나눈다. 각 배치가 KREAM 체결→네이버 가격 검색→카탈로그→판매처의 동일 옵션 가격·배송·재고·판매자 사실→최종 감사를 마친 뒤 다음 배치로 간다. 시작 전 릴레이의 시간당 남은 페이지 수를 확인해 배치 중간에 속도 상한에 걸려 관측값이 만료되는 일을 줄인다. 실패 배치는 새 attempt 폴더에서 다시 수집하며 이전 덤프를 재사용하지 않는다.
4. 여섯 역할의 규칙 엔진은 항상 실행한다. `--codex-efficient`에서는 제안 검증과 최종 감사만 기본 Codex CLI 모델 호출을 하고, 판매자 모호성 또는 대체 판매처 작업이 있을 때 해당 역할을 추가 호출한다. 오류와 성과는 규칙으로 처리한다. AI 호출은 최대 32행 단위의 제한된 요약만 입력하며, AI는 후보를 승격하지 못한다.
5. `automation/report.mjs`는 No1 Seller Center 관측 파일을 대조한다. 동일 KREAM ID·사이즈, 모델·색상 일치, 10분 내 자료, 최근 30일 동일 사이즈 체결 3건 이상, 재고, 조건 없는 결제 가격, 즉시매도 기준 순익을 요구한다. 누락·불일치·낡은 자료는 보류한다.
6. 배치별 `automation-final.json`·HTML·엑셀을 만들고 완료한 배치만 날짜별 상위 보고서에 집계한다. `batches.json`과 `dot-screening-queue.json`은 진행 상황과 Dot 독립 검토 대상을 기록한다. AI 호출의 실제 입력·출력 토큰은 `agents-team-ai.json`에 기록된다.

## No1 Seller Center 활용

| 기능 | 위치와 용도 |
|---|---|
| KREAM/POIZON 옵션별 시세·차트·30일 체결 | 최종 후보의 수요와 즉시매도 손익 교차 검증 |
| MUSINSA 인기순 | 다음 날 검색 소스 선정 보조. 현재 CLI에서 자동 추출되지 않음 |
| 내장 자동 소싱 | 무신사 랭킹/선택 브랜드를 1~24시간 간격으로 KREAM·POIZON과 비교한다. 추천 사이즈·마진·예상 거래량·재고를 후보 발견의 보조 신호로 쓴다. 30일 거래량은 8일치 외삽일 수 있어 최종 증빙으로 단독 사용하지 않는다. |
| 43개 사이트 재고 확인 | 판매처 동일 옵션 재고 교차 검증. 선택 가능 UI를 확정 재고 수량으로 취급하지 않음 |
| 목표가 알림 | 보류 후보의 가격 변화 재검토 신호 |
| 판매·입고·바코드·송장 내역 | 실제 판매 뒤 정산/반품/재고 추적의 향후 연결점. 현 단계에서 주문·송장 변경 없음 |

관측 파일은 각 실행 폴더의 `no1-observations.json`이다. 예시:

```json
{
  "version": "no1-observations-v1",
  "items": [{
    "kreamId": "123", "size": "S", "capturedAt": "2026-11-09T05:00:00.000Z", "dataAsOf": "2026-11-09T04:59:00.000Z",
    "sourceUrl": "https://seller.example/item/1",
    "kreamModel": "MODEL-01", "sourceModel": "MODEL-01",
    "kreamColor": "BLACK", "sourceColor": "BLACK",
    "sameSizeTrades30d": 5, "sourceStock": 2,
    "checkoutCost": 120000, "conditionalDiscount": false,
    "instantBid": 200000
  }]
}
```

앱의 자동 소싱 화면과 공식 사이트에서 소싱 결과의 CSV·엑셀 대량 추출/API는 확인되지 않았다. 따라서 No1 자료의 **무인 생성은 아직 연결되지 않았다**. 관측 파일이 없으면 자동 보고서는 후보를 보류한다. 이 한계를 숨기지 않고 `NO1_OBSERVATION_MISSING`으로 남긴다. 앱의 매출/송장 엑셀 내보내기는 상품 탐색 500건의 대량 피드와 별개다.

## 실행 명령

프로젝트 루트에서:

```powershell
codex login status
node automation/loop.mjs --dry-run
node automation/loop.mjs --once
node automation/loop.mjs
```

마지막 명령은 24시간 간격으로 계속 실행한다. 시작할 때 저장된 ChatGPT 로그인을 확인하고 릴레이를 자동 기동한다. 중지는 `node automation/commander.mjs stop`, 재개는 `reset-stop` 후 `start`다. `--once`는 단일 실행이다. 각 날짜별 상태는 `kream-runs/automation/loop-state.json`에 저장되며 완료한 배치는 재실행하지 않는다. 시스템 재시작 후 자동 시작을 원하면 Windows 작업 스케줄러에 마지막 명령을 등록한다. 현재 첫 500개 주기의 5개 단위 배치 실행이 진행 중이다.

No1 관측 파일을 별도로 확보한 실행은 `node automation/report.mjs <실행폴더>`로 HTML/엑셀을 다시 생성한다.

CLI는 저장된 ChatGPT 인증으로 실행되며, Anthropic API 키는 필요 없다. Claude API 대안은 `--claude-efficient`로 남겨 두었다. OpenAI 공식 문서는 Pro에 Codex CLI와 `codex exec` 자동화를 포함하지만 구독 사용량 제한이 적용된다고 설명한다. API 가격으로 구독 사용량을 추정하지 않는다. 참고: [Codex 요금/범위](https://learn.chatgpt.com/docs/pricing), [비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode).

## 검증과 남은 운영 조건

- 합성 데이터에서 선택형 6역할 흐름, No1 보류/통과, HTML/XLSX 생성, Claude 구조화 응답을 검증했다.
- 실제 ChatGPT 인증 `codex exec` 구조화 응답 1건이 성공했다.
- 전체 기존 테스트는 핵심 74건과 Playwright 브라우저 14건이 통과했다. 브라우저 테스트용 패키지는 임시 폴더에 설치했다.
- **500개 실제 완료는 미검증**: 20개 목록 소스에서 고유 ID 500개를 확보했고, 릴레이·확장 0.4.8·KREAM 로그인을 실전 확인했다. 시간당 상한은 150페이지라 전체 완료에는 수 시간이 걸린다. 첫 배치 5개는 약 2분 30초에 완료했다.
- `Setup-Other-PC.ps1`을 이 PC에서 완료했고 검증 스크립트가 통과했다. Dot은 직접 `smoke`·`start`를 실행하고 매일 09:00 KST 점검을 예약했다. Dot의 독립 상품 스크리닝도 첫 배치부터 진행 중이다. No1 관측 파일 자동 수집 연결이 없으므로 완전 무인 승인 후보는 나오지 않는다.
