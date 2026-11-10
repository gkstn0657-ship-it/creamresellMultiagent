---
description: 크림 스톤아일랜드(또는 검색어) 리셀 소싱 — 확장 덤프 + 네이버 신뢰판매처 대조 → 엑셀. 사용: /kream-si [최대상품수=50] [크림 검색어=스톤아일랜드]
---
# 크림 리셀 소싱 플레이북
인수 `$ARGUMENTS`: 첫 토큰이 숫자면 최대 상품 수(기본 50), 나머지는 크림 검색어(기본 스톤아일랜드).
도구: `kream-tools/*`, 확장 `naver-extension/`(사용자가 로드해 둠), 릴레이 `127.0.0.1:8787`.

## 전제 확인 (하나라도 실패하면 멈추고 사용자에게 알림)
1. `GET http://127.0.0.1:8787/jobs` 응답 — 안 되면 `node kream-tools/relay-server.mjs kream-runs/<YYYYMMDD>` 를 백그라운드로 띄움.
2. Chrome 도구(`claude-in-chrome`) 연결 — 없으면 `/chrome` 안내.
3. 실행 폴더 `kream-runs/<YYYYMMDD>/` 생성.

## 절차
1. **크림 후보 수집**: Chrome 도구로 `https://kream.co.kr/search?keyword=<검색어>` 열고 스크롤해 상품 링크를 모은다. 카드에 `%`(정가 대비 할인) 표시가 있거나 "키즈"인 것은 제외. 상위 N개 ID를 `k50-ids.json`에 저장.
2. **크림 덤프 작업**: `jobs.json`에 `{"id":"K<id>","url":"https://kream.co.kr/products/<id>","actions":[{"wait":1500},{"click":"거래 내역 더보기","after":2500}]}` 추가. `dump-K*.json`이 N개 모일 때까지 기다림(분당 2~4건). 차단 화면(STOP 파일)이면 중단.
3. `node kream-tools/parse-kream.mjs <run>` → `k50.json`. (parse-kream.mjs의 `extra` 배열은 이전 실행 전용이므로 새 실행에서는 비워 둔다.)
4. `node kream-tools/make-n-jobs.mjs <run>` → 네이버 검색 작업 생성. 덤프 완료 후 `node kream-tools/parse-si.mjs <run> N k50.json n-cards.json`.
   - 모델 일치 0건인 상품은 `make-n-jobs.mjs <run> q2`로 재검색.
5. 마진 가능 카드(순수익 ≥ 1만, ≥ 8%, 색상 불일치 아님)의 **카탈로그 링크**를 `N<id>-cat` 작업으로 추가 → `node kream-tools/parse-si-cat.mjs <run> N k50.json n-cat.json`.
6. 신뢰 판매처 최저가가 있는 상품만 상품 페이지를 `N<id>-prod` 작업으로 덤프해 **재고(품절/수량)·상호·대표자**를 읽는다. Chrome 도구로 크림 상세 차트(1개월/3개월/전체)를 확대해 추세를 적는다.
7. `kream-tools/build-final-n.mjs`의 `OV` 테이블을 이번 후보로 갱신(시세는 해당 사이즈 기준 재계산) → 실행 → `python -I kream-tools/export-xlsx.py <run>/final-all.json <run>/kream-<검색어>-<날짜>.xlsx`.
8. 보고: 후보 표(상품·크림시세·매입가·순수익·판매처·차트·재고·리스크), 제외 사유 분포, 엑셀 경로. 숫자는 전부 json 값만 쓴다.

## 원칙
- 모델번호와 색상 코드(V....)가 모두 일치해야 같은 상품. 싼 매물이 다른 색상이면 제외.
- 신뢰 판매처 외 매물은 "참고"로만 표기.
- 사람 속도 유지(릴레이 제한 그대로), 캡차·접속 제한 시 즉시 중단, 구매·결제 동작 금지.
- 덤프 파일에는 개인정보가 섞이니 외부 공유 금지.
