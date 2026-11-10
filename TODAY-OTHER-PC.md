> **2026-11-10 이전 안내:** 이 문서는 과거 기록입니다. 현재 백그라운드 No1·고정 순환 탐색 이전은 [OTHER-PC-20261110.md](OTHER-PC-20261110.md)를 먼저 따르세요. 아래의 No1 창 복원·화면 조회·옛 탐색 시작 지시는 현재 운영에 적용하지 않습니다.

# 2026-11-09 작업을 다른 Windows PC에서 재현하기

## 포함된 것과 현재 결과

- Dot 메인 커맨더용 CLI, 6개 검증 역할, Chrome 릴레이, 진행판, HTML/XLSX 생성 코드와 오늘 완료한 100개 실행 기록
- Chrome 확장 `naver-extension` 버전 0.4.8
- No1 Seller Center 화면을 읽는 로컬 stdio MCP 3개 도구: 고정 상품 시세, 모델 검색 시세, 무신사 URL별 재고·최대혜택가. No1 설치본은 포함하지 않음
- No1 시세·재고로 먼저 예상 마진을 계산하고 확인되지 않은 필드만 기존 릴레이로 보내는 별도 실행 경로 `automation/no1-first-runner.mjs`; 실측 동일 상품 입력 예시 `automation/no1-first-seeds.example.json`
- 사용자가 제공한 No1 [사용 가이드](docs/No1-Seller-Center-사용가이드.txt)

오늘의 `cycle-02`는 **상품 100/100 처리, 수익 후보 0, 옵션별 보류 18, 제외 100**으로 끝났다. No1 자동 관측은 0이다. 이 기록은 이력이며, 다른 PC에서 자동 재생하지 않는다. 새 No1 우선 경로는 동일 상품의 KREAM ID와 무신사 URL이 짝지어진 입력이 있어야 실행된다. 현재 기본 `automation/loop.mjs`와 매일 09:00 Dot 예약은 이 경로로 자동 전환되지 않았다.

## 1. 이 PC에서 ZIP 만들기

`Cream` 폴더에서 다음을 실행한다. 생성된 ZIP과 `.zip.sha256`, `.zip.json`을 함께 옮긴다. ZIP에는 수집한 상품 페이지 원문과 실행 결과가 포함되므로 개인용으로 보관한다. 브라우저 로그인·비밀번호·토큰·`.env`·프로세스 상태는 포함하지 않는다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\pack-for-other-pc.ps1 -Destination "C:\path\Cream-20261109-handoff.zip"
python tools\pack_workspace.py --verify "C:\path\Cream-20261109-handoff.zip"
```

## 2. 대상 PC에 설치

1. Windows에서 Node.js 20 이상, Python, Chrome, Codex CLI를 설치한다. Codex CLI는 본인 ChatGPT 계정으로 로그인한다.
2. No1 Seller Center를 해당 Windows 사용자 계정에 설치하고 앱에서 로그인한다. 오늘 확인한 실행 파일 버전은 **1.35.8.730**이고 연결기는 `%LOCALAPPDATA%\Programs\no1-center-electron\No1 Seller Center.exe`를 기대한다. 앱 설치본·로그인 정보는 ZIP에 없다.
3. ZIP을 새 폴더에 풀고 그 안의 `Cream`을 작업 폴더로 사용한다. 과거 `cycle-02`의 JSON에는 옛 PC 절대 경로가 남아 있으므로 이력 열람에만 쓴다.
4. 해당 `Cream`에서 아래 명령을 실행한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Setup-Other-PC.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Verify-Today-Other-PC.ps1
```

5. Chrome `chrome://extensions`에서 개발자 모드를 켜고 **압축을 푼 현재 `Cream\naver-extension`**을 로드한다. 표시 버전이 0.4.8인지 확인한다. KREAM과 네이버에 대상 PC의 Chrome에서 로그인한다. No1 창을 복원된 상태로 유지한다. No1 MCP는 Windows의 현재 로그인 화면을 읽으므로 최소화되거나 잠금 화면이면 실패한다.
6. 릴레이와 진행판은 필요할 때 각각 한 번만 시작한다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Relay.ps1
node automation\dashboard.mjs
```

진행판은 `http://127.0.0.1:8765/`이다. 첫 설치 직후에는 이전 PC의 완료 상태를 자동 표시하지 않는다. 과거 보고서는 `kream-runs\automation\2026-11-09-cycle-02\automation-report.html`을 직접 연다.

## 3. Dot 연결 재현

대상 PC의 ChatGPT 데스크톱 앱에서 Dot이 그 PC를 제어할 수 있도록 연결하고, 아래 내용을 Dot에게 전달한다. **Dot 자체의 예약과 PC 접근 승인은 ZIP으로 이전되지 않으므로 대상 PC에서 새로 설정한다.** No1 MCP는 Dot에 네이티브 등록된 도구가 아니라 이 PC의 `node` CLI가 호출하는 로컬 stdio 서버다.

> 이 Windows PC의 `<압축을 푼 경로>\Cream`을 Cream 작업 폴더로 사용해. `TODAY-OTHER-PC.md`, `automation/DOT-COMMANDER.md`, `automation/NO1-FIRST.md`를 읽고 `node automation/commander.mjs doctor`와 `status`를 먼저 실행해 결과를 보고해. 새 작업을 시작하기 전에 기존 루프와 릴레이 중복 실행 여부를 확인해. No1은 시세·재고·최대혜택가의 1차 예상 마진에 쓰고, 실결제가·할인 조건·판매자·배송비·재고 재확인 등 부족한 정보만 기존 릴레이로 수집해. KREAM ID·모델·색상·옵션이 불일치하거나 시세가 오래됐으면 보류해. 구매·입찰·등록은 하지 마. 완료된 2026-11-09 cycle-02를 재시작하지 마. 매일 09:00 KST 상태 점검 예약은 이 PC에서 새로 만들어 줘.

`node automation/commander.mjs doctor`는 Codex 로그인과 릴레이 상태를 읽는다. `smoke`나 `start`는 새 수집을 수행하므로 설치 검사에서 자동으로 호출하지 않는다. 기본 `start`는 기존 수집 루프다.

## 4. No1 우선 경로 실행

새 `seeds.json`에 동일 상품의 `kreamId`, `kreamModel`, `sourceModel`, 무신사 `sourceUrl`, KREAM `size`와 무신사 `sourceOption`·`sourceColor`를 기록한다. 모델 문자열이 다르면 상품별 매칭 근거도 기록한다. 실측 입력 예시는 [NO1-FIRST.md](automation/NO1-FIRST.md)와 [예시 JSON](automation/no1-first-seeds.example.json)에 있다. 오늘 No1에서 처음 화면 전환에 쓴 두 상품은 서로 달랐지만, 이후 KREAM `1120286` 블랙 L과 무신사 `7481180` 블랙 L(100)의 동일 상품 쌍을 [별도로 검증했다](automation/no1-mcp-prototype/live-matched-product-result.json). 이 쌍의 No1 시세는 조회 시점에 이미 오래돼 수익 판정에는 쓰지 않았다.

```powershell
node automation/no1-first-runner.mjs --seeds=<seeds.json> --policy=<agent-policy.json> --out=<새-빈-폴더> --live --collect-fallback
```

No1의 매입가 기본값 50,000원과 화면 표시 마진은 사용하지 않는다. 무신사 최대혜택가는 쿠폰·등급·결제수단 조건이 포함될 수 있는 추정가이고 실제 결제가는 아니다. 원천 갱신 시각이 표시되지 않는 재고도 기존 판매처 수집으로 다시 확인한다. 이 실행 경로는 현재 원본 덤프를 모으는 단계까지이며 최종 후보 승인과 HTML/XLSX 생성에는 연결되지 않았다. 자동 대량 상품 발견은 No1에서 확인되지 않아 초기 KREAM ID·판매처 URL 목록이 필요하다.

## 5. 확인 기준

- `Verify-Today-Other-PC.ps1`이 통과하고 확장 0.4.8을 Chrome에서 활성화했는지 확인한다.
- No1 연결기는 [실측 검증 기록](automation/no1-mcp-prototype/README.md)에 명시된 도구 3개를 노출한다. 시세↔재고 화면 전환과 잘못된 모델 차단은 원래 PC에서 검증했다. 다른 PC에서는 새 설치·로그인 후 실화면 단건을 다시 확인한다.
- Dot `doctor`의 `codexSignedIn`이 `true`인지, 릴레이가 올바른 새 폴더를 가리키는지 확인한다.
- 100개 완료 기록은 그대로 보존하고, 새 실행은 새 폴더에서만 만든다.
