# 크림(KREAM) 리셀 소싱 파이프라인 — 다른 PC 설치 안내

크림 시세와 네이버 가격비교(신뢰 판매처)를 대조해 수익 후보를 엑셀로 뽑는 도구 모음입니다.
수집은 **사용자 Chrome에 설치한 확장**이 하고, 계산·정리는 로컬 스크립트가 하며, Claude Code가 지휘합니다.

## 1. 준비물
| 항목 | 비고 |
|---|---|
| Node.js 20 이상 | `node --version` |
| Python 3.8 이상 + openpyxl | `pip install openpyxl` |
| Chrome(또는 Edge) | 크림·네이버에 **로그인**한 상태 권장 (크림 거래내역은 로그인 필요) |
| Claude Code + Claude in Chrome 확장 | 크림 차트 확인·지휘용. `/chrome`으로 연결 |

## 2. 폴더 구조
```
Cream/
├ kream-tools/        스크립트(릴레이 서버, 파서, 엑셀)
├ naver-extension/    Chrome 확장(네이버·크림 페이지 덤프 수집기)
├ .claude/commands/   Claude Code 플레이북(/kream-si)
├ kream-runs/<날짜>/  실행 결과(엑셀, json). dump-*.json은 개인정보 포함 → 공유 금지
└ README-kream.md
```

## 3. 설치 (1회)
1. 이 폴더를 통째로 복사합니다 (`kream-runs/*/dump-*.json`은 빼도 됨).
2. `pip install openpyxl`
3. Chrome → `chrome://extensions` → **개발자 모드** 켬 → **압축해제된 확장 프로그램을 로드합니다** → `naver-extension` 폴더 선택.
   - 확장 아이콘을 누르면 "자동 실행(1분마다 작업 확인)" 체크와 로그가 보입니다.
4. Claude Code를 이 폴더에서 실행하고 `/chrome`으로 브라우저를 연결합니다.

## 4. 실행 순서 (스톤아일랜드 예시)
```powershell
# ① 릴레이 서버 (작업 큐 + 덤프 수신). 실행 폴더는 날짜로 새로 만듦
node kream-tools\relay-server.mjs kream-runs\20261106
```
그 다음 Claude Code에서 `/kream-si 50` 을 실행하면 플레이북이 아래를 순서대로 수행합니다.
1. 크림 검색 페이지에서 할인 표시 없는 상품 ID를 수집 → `k50-ids.json`
2. 확장이 크림 상품 페이지(거래내역 창 포함)를 덤프 → `parse-kream.mjs` → `k50.json`
3. `make-n-jobs.mjs`로 네이버 검색 작업 생성(모델번호 띄어쓰기 형식, 낮은 가격순, "추천 낮은 가격순" 해제)
4. `parse-si.mjs N k50.json n-cards.json` → 마진 가능 카드의 카탈로그 작업 추가 → `parse-si-cat.mjs N k50.json n-cat.json`
5. 신뢰 판매처 최저가 상품 페이지 덤프로 재고·판매자 정보 확인, 크림 차트는 Claude가 직접 확인
6. `build-final-n.mjs` → `export-xlsx.py` → `kream-stoneisland-<날짜>.xlsx`

수동으로 돌릴 때 핵심 명령:
```powershell
node kream-tools\parse-kream.mjs   kream-runs\20261106
node kream-tools\make-n-jobs.mjs   kream-runs\20261106        # 두 번째 검색어: 뒤에 q2
node kream-tools\parse-si.mjs      kream-runs\20261106 N k50.json n-cards.json
node kream-tools\parse-si-cat.mjs  kream-runs\20261106 N k50.json n-cat.json
node kream-tools\build-final-n.mjs kream-runs\20261106
python -I kream-tools\export-xlsx.py kream-runs\20261106\final-all.json kream-runs\20261106\result.xlsx
```

## 5. 작업 큐 형식 (`jobs.json`)
```json
{"jobs":[
  {"id":"K12345","url":"https://kream.co.kr/products/12345","actions":[{"wait":1500},{"click":"거래 내역 더보기","after":2500}]},
  {"id":"N12345-s","url":"https://search.shopping.naver.com/search/all?sort=price_asc&query=L1S15%206100060%20S0051-V0029",
   "actions":[{"wait":1500},{"toggleOff":"추천 낮은 가격순"}]}
]}
```
확장은 1분마다 `GET /jobs`로 작업을 받아 페이지 텍스트·링크를 `dump-<id>.json`으로 돌려줍니다.
릴레이 속도 제한: 작업 간 15초, 한 번에 4건, 시간당 150페이지. 접속 제한·캡차 화면이 보이면 `STOP` 파일을 만들고 멈춥니다(`POST /resume`으로 해제).

## 6. 판정 기준 (build-final-n.mjs)
- 순수익 = 크림 시세 × 0.95 − 3,000 − 매입가
- 후보: 순수익 ≥ 10,000원, 수익률 ≥ 8%, **모델번호+색상코드 일치**, **신뢰 판매처**(롯데ON·SSG·신세계·현대·머스트잇·W컨셉·트렌비·LFmall 등), 재고 있음
- 협업 상품(슈프림·뉴발란스·포터), 모델번호 없음, 체결 10건 미만, 시세 15만 원 미만은 제외

## 7. 주의
- 확장은 **로그인된 사용자 계정**으로 페이지를 엽니다. `dump-*.json`에 아이디 일부가 남으니 공유하지 마세요.
- 네이버·크림 약관상 자동 수집은 제한 대상입니다. 소량·사람 속도로만 쓰고, 차단 화면이 나오면 중단하세요. 책임은 사용자에게 있습니다.
- 작업이 끝나면 `chrome://extensions`에서 확장을 끄세요.
- 코드를 고친 뒤에는 확장 카드의 새로고침(↻)을 눌러야 반영됩니다.
