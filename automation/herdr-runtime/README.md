# Cream Herdr 자율 소싱

## 수집 제외 원인 진단

무신사 랭킹 배치가 끝나면 별도 진단 에이전트가 저장된 No1 조회 근거를 읽고, 수집 제외 상품의 KREAM·POIZON 원인을 각각 기록한다. 원인과 근거 해시는 코드가 재구성하고, 에이전트는 각 건의 근거를 읽은 뒤 설명과 다음 확인 항목을 작성한다. 진단은 소싱을 재시작하거나 상품을 다시 조회하지 않는다. 결과는 실행 폴더의 `exclusion-diagnostics/cases/<무신사 상품 ID>.json`과 `summary.json`에 저장되고 Herdr 대시보드의 탐색 결과에서 볼 수 있다.

중단된 기존 작업의 저장 기록만 진단하려면 프로젝트 루트에서 다음 명령을 실행한다.

```powershell
node automation/herdr-runtime/exclusion-agent.mjs --dir=kream-runs/herdr-continuous-20261127
```

`reconstructed-from-saved-evidence`는 저장된 검색 페이지와 옵션 응답으로 단계를 재구성했다는 뜻이다. 검색 범위에서 모델을 못 찾은 결과를 시장 전체의 상품 부재로 해석하지 않는다. `partial`은 저장 근거가 부족해 세부 원인을 확정할 수 없다는 뜻이다. 기존 수집 제외는 상품 검토 AI의 탈락 결정으로 집계하지 않는다.

### 수집 제외 해결 담당

`exclusion-resolution-agent.mjs`는 진단이 완료된 제외 건을 읽고 실제 재수집 조치를 결정한다. 실행 중인 무신사 Herdr 작업에서는 별도 감시 프로세스가 1분 간격으로 새 진단과 재확인 시점을 확인하며 한 번에 최대 2건을 처리한다. 재조회에서는 제조사 품번의 공백·하이픈 검색 변형을 추가로 사용하되 시장 상품의 품번 일치 검사는 유지한다. KREAM 표시 사이즈에 성별 접두사가 있는 경우 시장 응답의 명시적 옵션 라벨이 매입처 옵션과 유일하게 일치할 때만 연결한다. 새 상품 근거가 수집되면 기존 상품 담당·독립 검토 절차를 실행한 후에만 `recovered`로 기록한다. 원래 제외 기록은 보존한다.

결과는 실행 폴더의 `exclusion-resolution/cases/<무신사 상품 ID>.json`과 `summary.json`에 저장되며 대시보드의 제외 원인 상세에서 확인한다. 재조회 후에도 일치 상품·옵션·양의 마진이 없으면 `still_excluded`로 남고 근거가 바뀌기 전까지 정해진 간격으로 대기한다. 수동으로 한 차례 확인하려면 `node automation/herdr-runtime/exclusion-resolution-agent.mjs --dir=<Herdr 실행 폴더>`를 사용한다. `--watch`는 같은 작업의 STOP까지 감시한다. 구매나 소스 코드 수정은 하지 않는다.

본 소싱의 배치가 수집·판단 중이거나 `NO1_BRIDGE_BUSY` 복구를 기다리는 동안 해결 담당의 새 No1 재조회는 보류한다. 완료·오류 배치의 오래된 PID가 다른 프로세스에 재사용돼도 워커 실행 중으로 계산하지 않는다. 해결 담당 프로세스가 중단된 채 남긴 `rechecking` 기록은 다음 시작 시 보류 상태로 복구한다.

Herdr 0.9.5 Windows에서 실행하는 별도 소싱 런타임이다. AI 지휘자가 관측된 후보 선택, 다음 목록 조회, 분석 실행, 대기, 실패 배치 재시도와 종료를 결정한다. 상품 판단은 기존 담당 AI와 독립 검토 AI가 수행한다. 계산·저장·중복 방지·수량 상한·STOP·검토 유효성은 코드가 강제한다. 구매, 계정 조작, 운영 중 코드 수정은 제공하지 않는다.

기존 실행기의 고정 탐색 정책은 그대로 남는다. 이 경로는 2026-11-26 사용자가 요청한 AI 자율 조율 모드다. Dot 원격 MCP의 기존 시작 도구는 이 런타임으로 자동 전환되지 않는다.

## 구조

```
Herdr workspace
  controller pane: Sol/high 지휘자 → 구조화된 도구 호출
    connection / catalog / analyze / status / retry_batch / wait / finish
  batch tab: 순차 수집 → 상품 담당 2개까지 병렬 실행 → 각각 독립 검토
    owner: Luna/medium → 근거를 제시해 Sol/high로 1회 승격 가능
    review: Luna/medium; adopt·심층검증 요청·동일 근거 재작업: Sol/high
```

담당과 검토는 서로 다른 Codex thread다. 현재는 배치 워커의 app-server에서 실행하며 각각 별도 Herdr 패널로 분리하지 않는다. Herdr에는 배치 진행 로그와 상태가 표시된다. 워커 결과·근거·검토의 원본은 Cream에 있다. Herdr의 idle 상태나 명령 전송 성공은 상품 완료 증거가 아니다.

## 실행

프로젝트 루트에서 Node.js 24와 로그인된 Codex CLI를 사용한다. Herdr는 `CREAM_HERDR_BIN`, `%LOCALAPPDATA%/CreamHerdr/v0.9.5/herdr.exe`, PATH 순으로 찾는다. 별도 `cream-autonomous` 세션을 백그라운드에서 시작한다.

```powershell
# 무신사 현재 랭킹 설정에서 매입처 상품 5개 점검. 수익 후보 5개 확보 목표가 아니다.
node automation/herdr-runtime/run.mjs start --dir=kream-runs/herdr-work-01 --target=5 --source=musinsa-ranking '--instruction=무신사 현재 랭킹에서 상품 5개를 자율 점검하고 KREAM과 POIZON 근거를 독립 검토해'

# 중지 요청까지 무신사 랭킹의 새로운 상품을 계속 점검. 상품 수 목표 없음.
node automation/herdr-runtime/run.mjs start --continuous --dir=kream-runs/herdr-continuous-01 --source=musinsa-ranking '--instruction=무신사 현재 랭킹의 새로운 상품을 계속 점검하고 KREAM과 POIZON 근거를 독립 검토해'

# 상태와 중단
node automation/herdr-runtime/run.mjs status --dir=kream-runs/herdr-work-01
node automation/herdr-runtime/run.mjs stop --dir=kream-runs/herdr-work-01

# 사용자가 요청한 명시적 재개. 사용한 턴 수와 결과는 보존한다.
node automation/herdr-runtime/run.mjs resume --dir=kream-runs/herdr-work-01

# 필요할 때 누적 턴 한도를 명시적으로 늘리며 재개
node automation/herdr-runtime/run.mjs resume --dir=kream-runs/herdr-work-01 --max-turns=150

# Herdr 화면 연결
& "$env:LOCALAPPDATA/CreamHerdr/v0.9.5/herdr.exe" --session cream-autonomous
```

일반 KREAM 후보 탐색은 `--source=kream-popularity`를 사용한다. 기존 인기순 커서·중복 DB를 유지하고 관측한 후보 중 다음 분석 대상을 AI가 고른다. 무신사는 현재 category/period/gender/age 설정의 all 목록을 읽고 별도 무신사 중복 기록을 사용한다. 기존 완료 상품을 다시 선택하지 않는다. 현재 무신사 모드는 선택된 랭킹 문맥만 다루며 모든 하위 카테고리로 자동 확장하지 않는다. 설정이 도중에 바뀌면 중단 원인으로 남긴다.

무신사 전체 랭킹에서는 샴푸·기초 케어·식품·상품권처럼 KREAM 재판매 후보로 부적합한 것이 명백한 상품을 배정 전에 제외한다. 랭킹에는 상품별 카테고리가 없으므로 상품명에 명시된 신호만 사용한다. 남은 후보도 실제 KREAM·POIZON 조회에서 동일 품번, 옵션, 재고와 예상 마진을 확인해야 한다.

`--target`은 1~500이며 필수다. 무신사는 점검한 매입처 상품 수, 일반 KREAM은 독립 검토가 완료된 상품 수다. 재고 없음·매칭 실패·조회 실패 건너뛰기는 무신사 점검 내역으로 남지만 수익 채택으로 집계하지 않는다. 수익 후보 N개 확보나 무기한 운영은 이 CLI의 목표 유형이 아니다. 턴 기본 한도는 100, 도구 호출 한도는 턴 한도의 20배다. 완료되지 않으면 complete로 꾸미지 않는다.

`--continuous`는 사용자가 중지할 때까지 무신사 랭킹을 반복 확인한다. 내부 예약 단위는 최대 5개이며 상품 수 목표와 턴 한도를 적용하지 않는다. 이미 확인한 매입처 상품은 저장된 중복 기록으로 다시 배정하지 않는다. 현재 선택한 랭킹에 새 상품이 없으면 대기한 뒤 다시 확인한다. No1 브라우저 확장과 인증이 준비되지 않으면 작업은 `waiting_connection`으로 남고 백그라운드에서 재확인한다. 기존 유한 작업에는 이 옵션이 영향을 주지 않는다. 다른 연속 작업을 교체할 때만 `--replace-work=<기존 작업 ID>`를 명시한다.

No1 브리지가 없으면 AI가 기존 로컬 서비스만 백그라운드로 시작할 수 있다. 브라우저 확장 연결, No1 인증, KREAM·무신사 인증이 필요하며 화면 조작으로 우회하지 않는다. 기존 미완료 작업과 충돌하면 자동으로 중단·덮어쓰기 하지 않는다.

## 저장과 복구

- 실행 폴더 `state.json`: 지휘자 thread, 목표, 배치 예약, 사용한 턴·도구 수.
- `events.jsonl`: AI 도구 결정과 결과. 관측 자료는 지시로 취급하지 않는다.
- 기존 `agent-teams/batch-*`: 원자료, 상품별 판단·검토, 워커 상태.
- 무신사 배치 `sources.json`, `source-state.json`, `source-<id>.json`: 매입처 진행과 패킷.
- 예약은 외부 실행 전에 저장한다. 응답 유실 시 자동으로 새 상품을 예약하지 않는다.
- 배치 복구는 최대 2회이며 시작 직후 30초는 실행 확인을 기다린다. 살아 있는 워커나 다른 활성 배치가 있으면 중복 실행을 막는다.
- STOP은 사용자 resume에서만 해제한다. 사용자가 중단한 과거 작업은 자동으로 재개하지 않는다.
- 만료된 미완료 무신사 근거는 재수집한다. 갱신으로 상품 식별자가 달라지면 원래 작업 범위를 조용히 바꾸지 않는다.
- 지휘자 턴의 5분 시간 초과는 실행 중 도구의 저장을 마치고 이전 턴의 종료를 확인한 뒤 같은 thread에서 감시를 계속한다. 워커를 다시 띄우지 않으며, 이미 사용한 턴·도구 예산과 STOP을 유지한다. 이전 턴 종료를 확인할 수 없거나 다른 모델 오류·예산 소진이면 needs_attention으로 남긴다.
- 상품 패킷 저장 뒤 진행 기록 전에 중단된 경우, 패킷 해시와 매입처 연결을 검증해 누락된 진행 기록과 KREAM·POIZON 중복 키를 복원한다. 관측시각은 변경하지 않는다.
- Herdr 표시 전송 실패는 `display-errors.jsonl`에 별도로 남긴다. 표시 장애가 저장된 분석 완료를 실패로 바꾸거나 수집을 중단시키지 않는다.
- PC 재부팅 자동 시작은 설치하지 않는다.

## 검증

```powershell
node --test automation/herdr-runtime/runtime.test.mjs automation/agent-team/batch.test.mjs automation/agent-team/team.test.mjs
node automation/herdr-runtime/verify-live.mjs
```

`verify-live.mjs`는 격리된 Herdr 세션에서 실제 Codex 모델이 합성 완료 자료를 읽고 구조화된 finish 도구를 호출하는지 검사한다. 실상품 수집이나 수익성 판정 검증이 아니다. 결과는 `kream-runs/herdr-validation/<시각>/verified.json` 또는 `failed.json`에 저장된다. 실행 직후 반환은 터미널 명령 전송 확인이며, verified.json을 별도로 확인해야 한다.
