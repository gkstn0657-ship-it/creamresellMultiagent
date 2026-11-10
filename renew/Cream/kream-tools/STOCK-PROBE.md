# 사이즈별 재고 탐색 (확장 0.4.0)

## 2026-11-08 실사이트 소량 검증

사용자 지정 상품 2개만 대상으로 진단과 재시도를 진행했다. 추가 상품 테스트는 하지 않았다.

- Chrome 실제 설치 폴더는 `C:/Users/HansuPark/Desktop/Cream/naver-extension`이었다. 작업 폴더의 확장과 별개라 두 폴더의 stock-probe.js에 동일한 수정 사항을 반영했다. 서비스워커의 기존 사용자 변경은 유지했다.
- SSG `itemId=1000809844693`: `#_ordOpt_area ._drop_list`와 `#cdtl_opt_bx_uitem`으로 본문 옵션/수량을 한정해 하단 고정바 중복을 제거했다. `M (95 around)`의 수량 이력은 `[1,1]`, +1회 후 `최대 주문가능수량은 1개 입니다.` alert를 수집해 `state:limit,maxQty:1`을 반환했다. 탐색 시간 5,505ms. 이는 주문 수량 제한 관찰이며 창고 실재고 1개라는 뜻은 아니다.
- 렉스몬드 `no=844323`: 기존 범용 선택자가 찜 수 78과 실측 사이즈 설명표를 옵션으로 오인했다. 실제 opener `#CateOptionName`, 목록 후보 `#ProductOPTList tbody tr[name=selectOption]`로 범위를 좁혔다. 최종 실행에서는 opener 클릭 후 보이는 목록을 확보하지 못해 `no-option-list/unknown`으로 반환했다(1,973ms). 안내문 `100,105,110`만 확인되었고 사이즈별 선택·수량은 검증되지 않았다. 렉스몬드 어댑터는 미완성이다.
- 최종 원본 결과: `../kream-runs/20261107-c/dump-probe-r5-ssg-prod.json`, `dump-probe-r5-rex-prod.json`. `probe-r1`~`r4`는 이전 코드/DOM 진단 기록이다. 테스트 작업은 완료 상태로 남겨 반복 실행되지 않는다.
- 금지 동작 검사는 유지했다. `구매하려는 색상 및 사이즈를 선택하세요`라는 안내문을 실제 구매 버튼과 구분하고, 동작이 없는 정확한 `javascript:void(0)` href만 허용했다. `#buyNow`, `#inputCart`, 구매·결제·주문 버튼은 클릭하지 않았다.

## 구성과 실행

`naver-extension/stock-probe.js`에 공통 `async stockProbe()`와 호스트별 어댑터가 있다. `background.js`의 `executeDump()`가 파일을 **ISOLATED world**에 넣고, 같은 documentId에 MAIN 팝업 훅을 설치한 뒤 `pageDump()`를 실행한다. `pageDump()`는 그 world의 함수를 다음처럼 호출한다.

```js
const stockProbe = globalThis.kreamStockProbe;
const stock = stockConfig ? await stockProbe(stockConfig) : null;
// 반환 덤프에 stockProbe: stock 추가
```

함수 본문을 pageDump 안으로 옮길 수도 있지만, 현재는 공통 헬퍼·어댑터를 파일로 분리해 테스트와 변경이 쉽도록 했다. `executeScript({func})`는 바깥 클로저를 복사하지 않으므로 worker 함수/변수에 의존하면 안 된다.

```text
run-all: {stockProbe:true} 또는 기존 *-prod 작업
  → stock-probe.js 주입 / documentId 고정
  → MAIN alert·confirm·prompt 훅
  → pageDump → 옵션 열기 → 전체 보이는 옵션 기록
  → 안전 검사 → 사이즈 선택 → 선택 확인 → 해당 행의 + 최대 5회
  → dump.stockProbe → facts.json → build-final-auto → 재고확인 열
```

Chrome 확장 관리 화면에서 `Cream/naver-extension`으로 로드한 확장을 새로고침해야 적용된다. 기존 대기 중 `*-prod` 작업도 새 탐색을 사용하며 기존의 무작정 텍스트 클릭은 대체된다. 이미 저장된 덤프는 자동으로 재방문하거나 삭제하지 않는다. 예전 덤프로 `--replay`를 실행하면 새 UI 탐색 결과가 생기지 않는다. 기존 수집·릴레이를 이 작업 중 자동 실행하거나 확장을 자동 새로고침하지 않았다.

새 작업 예:

```json
{"id":"N123-prod","url":"https://판매처/상품","actions":[{"stockProbe":true}]}
```

## 안전·시간·결과 의미

- `safeTarget()`이 매 클릭/이벤트 전에 대상의 텍스트, aria-label, title, class, id, name, data-action, href, onclick 및 조상/자손을 검사한다. 구매·주문·결제·장바구니·담기·buy/cart/order 등은 거절한다. form의 submit 버튼과 이동 링크도 거절한다. 숨겨진 위험 버튼을 포함한 컨테이너도 누르지 않는다. probe 중 click/submit 캡처 리스너도 적용한다.
- `buy_area`처럼 옵션을 포함하는 큰 부모에 금지 class가 있어도 거절한다. 이 경우 안전하게 `unknown` 또는 부분 확인을 반환한다. 실제 DOM을 보고 검증된 전용 구조로 좁혀야 하며 금지 검사를 제거해서 해결하지 않는다.
- 일반 클릭은 `.click()` 한 번이다. native select는 표준 value setter + input/change 이벤트로 선택한다. OS 드롭다운을 시각적으로 여는 대신 이미 DOM에 있는 option을 열람한다. 커스텀 드롭다운은 실제로 열고 클릭한다.
- DOM에 식별 가능한 버튼을 차단하는 정책이다. 옵션으로 위장한 임의의 사이트 JS가 내부에서 구매 API를 호출하는 것까지 텍스트/class 검사로 증명할 수는 없다. 그런 사이트는 자동 탐색 대상에서 제외하고 읽기 전용 자료만 사용해야 한다.
- 주입 시작부터 19.5초 deadline, 매 동작 후 600ms 대기, 다음 동작을 시작하기 전 남은 시간 검사. 목록을 먼저 기록하므로 미탐색 사이즈도 `unknown`으로 남는다. 옵션이 많으면 전부 5회씩 검사할 수 없다. 20초 조건을 우선한다.
- 브라우저 메인 스레드 정지·백그라운드 타이머 지연에서는 JS가 정확히 20초에 반환하는 것을 보장할 수 없다. deadline 이후 새로운 클릭은 하지 않는다. 기존 전체 덤프 watchdog은 45초이며, 실패 시 탭을 닫아 실행 자체를 종료한다. `Promise.race`만으로 주입 JS가 취소된다고 가정하지 않는다.
- 로그인/인증/CAPTCHA/접근 제한이면 결과를 `unknown`으로 변경하고 같은 실행의 해당 호스트를 건너뛴다. UA 변경, CAPTCHA 해결, 자동 로그인, 접근 제한 우회를 하지 않는다. 검색·카탈로그 단계의 기존 STOP 처리는 유지된다.
- `maxQty`는 **화면에서 관찰된 최대 입력 수량**이다. 창고 재고 총량이나 구매 성공을 뜻하지 않는다. 시작 수량 1에서 + 5번이면 6까지 관찰할 수 있다. `quantityHistory`에 시작값과 각 클릭 결과가 남는다.
- `limit`은 disabled + 버튼 또는 명시적 재고/구매수량 제한 안내가 관찰됐다는 뜻이다. 1인당 정책 제한과 실제 재고 부족을 합치지 않고 `message`에 원문을 남긴다. 클릭 후 숫자가 그대로이기만 하면 제한으로 단정하지 않는다.
- 단순 disabled/aria-disabled는 색상 미선택 때문일 수 있어 `unknown + disabledReasons`로 기록한다. 명시적 품절 텍스트/품절 class가 있어야 `soldout`이다. `available`도 선택이 확인된 UI 증거이며 주문 가능 보증이 아니다.

결과 예시(설명용이며 실제 판매처 측정값 아님):

```json
{
  "version": 1,
  "adapter": "rexmonde",
  "complete": false,
  "enumerationComplete": true,
  "reason": "time-budget",
  "results": [
    {"size":"100","state":"soldout","maxQty":null,"message":"soldout-text","disabledReasons":["disabled","soldout-text"]},
    {"size":"105","state":"limit","maxQty":3,"message":"재고가 부족합니다","plusClicks":3,"quantityHistory":[1,2,3,3]},
    {"size":"110","state":"unknown","maxQty":null,"message":"미탐색"}
  ]
}
```

`results`가 요청한 배열이다. 바깥 객체는 시간 초과·부분 탐색·진단 근거를 보관한다. 커스텀 목록은 가상 스크롤로 숨은 옵션이 있을 수 있어 `enumerationComplete:false`로 둔다. native select도 여러 색상/추가 옵션이 있으면 전체 조합을 조사했다고 주장하지 않는다.

## MAIN 팝업과 ISOLATED 통신

`stock-dialog-main.js`의 `installStockDialogBridge(token, deadline)`는 직렬화 가능한 독립 함수다.

```js
await chrome.scripting.executeScript({
  target: {tabId, documentIds: [documentId]},
  world: 'MAIN',
  func: installStockDialogBridge,
  args: [token, deadline]
});
```

MAIN에서 `window.alert`를 메시지만 남기게 바꾸고, `confirm`은 항상 **false**, `prompt`는 null을 반환한다. 원래 descriptor를 저장해 종료 시 복원한다. `postMessage({source, token, kind, message}, location.origin)`로 ISOLATED에 전달한다. 수신 측은 `event.source === window`, origin, token, kind, 메시지 자료형을 검사한다. 매 클릭 전 ping/ready로 훅이 살아 있는지도 확인한다. 정리 방법은 ISOLATED의 stop 메시지, worker의 finally, MAIN 자동 만료 타이머다.

token은 실행을 구분하는 nonce이지 페이지에 대한 보안 경계가 아니다. MAIN과 DOM 자료는 페이지가 읽거나 위조할 수 있으므로 인증정보를 실어 보내지 않고, 들어온 메시지를 명령으로 실행하지 않는다. ISOLATED에서 `window.alert`만 바꾸면 페이지의 alert는 바뀌지 않는다. 공식 문서: [실행 world와 주입](https://developer.chrome.com/docs/extensions/reference/api/scripting), [격리 world](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

페이지가 **훅 설치 전에 원래 alert를 캐시**했거나, 다른 iframe에서 호출하거나, 완료 후 오래 지연된 콜백으로 alert를 호출하면 이 훅으로 모두 막을 수 없다. 이미 열린 대화상자를 나중에 설치한 훅으로 닫을 수도 없다. 해당 사이트는 `document_start`에 제한된 호스트/탐색 탭용 MAIN 브리지를 사전 등록하는 전용 어댑터가 필요하다. 현재 구현은 top frame만 검사하며 실패 시 unknown/탭 종료로 처리한다.

## 사이트별 선택자 전략

아래는 **현재 저장된 텍스트 덤프와 의미 기반 후보 전략**이다. 실제 페이지의 최신 DOM을 검증한 고유 CSS 선택자라고 주장하지 않는다. 해시 class를 지어내거나 구매 버튼으로 옵션 화면을 열지 않는다.

| 판매처 | 탐색 후보 | 확정에 필요한 DOM |
|---|---|---|
| 렉스몬드 | size/option 관련 select, `[class*="size" i]`, `[class*="option" i]`, `[data-option-group]`; 사이즈/옵션 opener | `구매 가능 사이즈` 안내와 실제 선택 UI의 관계, color→size 종속성, 선택 후 수량 행 |
| SSG | `select`, `[class*="opt" i]`, `[class*="size" i]`, `[role="listbox"]`; `선택하세요` | itemView의 옵션 버튼, aria-controls 대상, li의 품절/선택 속성, 해당 상품행의 수량 input 및 증가 버튼 |
| 롯데ON | option/size 영역, role=listbox; `SIZE 선택`, `옵션 선택`, `선택하세요` | 옵션 펼치기 전/후, PC·모바일 UI 차이, 옵션 선택 후 생성되는 행과 수량 연결 |
| 머스트잇 | option/size 영역, role=listbox; 사이즈/옵션 선택 | `m.web.mustit.co.kr` bottom sheet, 열기 버튼의 실제 기능, 옵션별 disabled, 선택 후 수량 영역 |
| 그 외 | 같은 의미 기반 공통 규칙 | 트렌비·G마켓·스마트스토어 등도 전용 어댑터 없이 시도하되 모호하면 unknown |

공통 규칙은 `aria-controls`로 연결된 목록도 조사한다. 품절 글자가 없는 class-only 표시, 중복된 PC/모바일 폼, 여러 판매자/색상 그룹은 DOM 확인 후 어댑터를 좁혀야 한다. 현재는 필수 색상·추가 옵션 조합을 임의로 선택하지 않고 `dependent-options-need-adapter`/`multiple-option-groups`로 반환한다. 머스트잇처럼 **구매 버튼을 눌러야만** 옵션 sheet가 열리는 상품은 이 조건에서는 탐색할 수 없다.

실제 어댑터를 확정할 때 아래 자료를 수집하면 된다(로그인정보·쿠키·토큰은 제외).

1. 상품 URL의 호스트/경로, PC/모바일 여부.
2. 옵션 열기 전 opener와 부모 1~2단계의 `outerHTML`.
3. 연 뒤 목록 컨테이너와 옵션 2~3개(가용·품절·disabled 각각)의 `outerHTML`.
4. 사이즈 선택 후 추가/갱신된 상품행, 수량 값 요소, + 버튼의 `outerHTML`.
5. 제한 발생 직후 toast/layer의 `outerHTML`과 사라지기까지의 시간. native alert는 반환 JSON의 messages로 수집된다.
6. 색상→사이즈 종속성, 옵션 선택 때 기존 행을 바꾸는지 누적하는지, iframe/shadow root/가상 목록 여부.

DevTools에서 해당 요소를 선택하고 `$0.outerHTML`로 복사하면 된다. 입력 필드의 개인정보, hidden token, 전체 로그인 페이지 HTML은 첨부하지 않는다. 덤프의 `stockProbe.diagnostics.controls`와 `availableSizeText`도 보조 자료로 남긴다. 현재 렉스몬드 덤프의 `구매 가능 사이즈 100 , 105 , 110`은 안내문 증거로 출력하되 선택·수량을 확인했다고 바꾸지 않는다.

## run-all → 재고확인 열

`stock-summary.mjs`가 순수 파서를 제공한다. `run-all.mjs`는 원문 `stockProbe`와 표시용 `재고확인`을 함께 facts.json에 보관한다.

```js
import { stockSummary } from './stock-summary.mjs';
const summary = stockSummary(dump);
facts[id] = {
  stockProbe: dump.stockProbe,
  재고확인: summary.text || '확인 불가: 재고 표시 문구 없음'
};
// 최종 행: {'재고확인': facts[id].재고확인}
```

예: `105: 수량 제한(UI), 관찰 최대 3개(실재고 아님) — 재고가 부족합니다`.

기존 `export-xlsx.py`에 재고확인 열이 이미 있어 exporter 변경은 필요 없다. `build-final-auto.mjs`는 JSON 결과를 우선하고 한 옵션의 품절을 상품 전체 품절로 판단하지 않는다. 전체 품절은 완전 열거된 목록이 모두 soldout인 경우에만 인정한다. 재고 품질 경보도 구조화 결과를 반영한다. 부분 탐색으로 확인한 가용 사이즈가 있으면 해당 사이즈만 수익 계산에 쓰고 미확인 사이즈는 JSON/재고확인 열에 남긴다.

## 실패하기 쉬운 경우와 읽기 전용 대안

- React/Vue 재렌더링: 저장한 DOM 노드를 재사용하지 않고 매 동작마다 optionKey/사이즈와 수량행을 다시 찾는다. 매핑이 사라지면 중단한다.
- 수량 제한 API의 늦은 응답/낙관적 UI: 600ms 안에 수량 증가가 보였더라도 서버가 나중에 되돌릴 수 있다. `maxQty`를 실재고로 사용하면 안 된다. 사이트별 검증된 응답 신호가 필요하다.
- `isTrusted` 검사, 숨김 탭 타이머 지연, closed shadow DOM, cross-origin iframe: 공통 구현으로 확정하기 어려우면 unknown. 우회하지 않는다.
- 여러 색상·추가 구성품·동일 옵션 중복·무한/가상 목록: 전체 조합 확인에 20초가 부족할 수 있다. 명시적인 목표 색상/사이즈를 입력받는 어댑터나 해당 사이트의 읽기 전용 자료를 사용한다.
- JSON-LD의 `Product`/`ProductGroup`/variant별 `offers.availability`: `InStock`, `OutOfStock`, `PreOrder` 등을 상품/variant ID·size와 연결한다. 상품 단위 InStock을 모든 사이즈 가용으로 확장하지 않는다. `AggregateOffer`도 사이즈 재고가 아니다. 가격/상태의 갱신 시점을 함께 기록한다.
- `offers.inventoryLevel`이 있으면 별도 출처로 저장한다. Schema.org도 현재의 대략적 재고를 표현하는 속성으로 정의하므로 UI 값과 출처를 합쳐 쓰지 않는다. [Offer](https://schema.org/Offer), [inventoryLevel](https://schema.org/inventoryLevel).
- 페이지가 이미 읽은 옵션 API 응답/공개 초기 상태: DevTools Network에서 실제 옵션 열기·선택 때 발생한 **조회** 응답을 확인하고 variant ID, 색상, 사이즈, soldout, selectable, stockQty, maxPurchaseQty 필드의 의미를 구분한다. 공개·허용된 조회 API나 판매자 제공 피드를 우선한다. 문서 없는 엔드포인트를 추측 호출하거나 장바구니/주문 API로 재고를 시험하지 않는다.
- 현재 코드는 네트워크 가로채기/API 호출/JSON-LD 자동 승격을 구현하지 않았다. 위 항목은 실사이트 DOM 검증 후 추가할 대안이다.

## 검증

```powershell
node --test Cream/kream-tools/tests/stock-probe.test.mjs
node Cream/kream-tools/preflight.mjs
```

테스트는 Playwright와 설치된 Chrome을 사용하지만 확장 런타임에는 라이브러리가 필요 없다. 가짜 페이지를 로컬 응답으로 제공하고 CDP의 별도 ISOLATED world에서 실행한다. 실제 판매처에 접속하거나 실제 구매 버튼을 시험하지 않는다.
