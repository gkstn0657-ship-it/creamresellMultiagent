# 모델 배치 실험 — 2026-11-26

실제 Codex 모델 호출로 합성 자료의 판단, 원자료 읽기, 구조화된 도구 사용을 비교했다. 실상품 수집·구매는 하지 않았다. 정책은 `../agent-team/model-policy.json`에 저장한다.

## 설계와 변경 기록

- 역할 3개(지휘자, 상품 담당자, 독립 검수자), 역할별 사례 2개, 모델 설정 4개, 반복 2회: 평가 48회.
- Luna/medium, Luna/high, Sol/medium, Sol/high를 새 스레드에서 비교했다. 모델명은 `gpt-6-luna`, `gpt-6.1-sol`이다.
- 완료 수량과 STOP, 정상 채택과 옵션·거래채널·수수료 충돌, 정직한 보류와 잘못된 채택을 검사했다. 원자료 읽기, 정확한 판단·문제 목록·근거, 구매 금지, 실제 선택 모델 일치를 확인했다.
- 사전 선택 규칙: 역할별 4/4 통과 설정 중 최저 중앙 실행시간을 선택하되 기존 기본값보다 15% 이상 빠를 때만 변경한다. adopt 검수는 Sol/high를 유지한다.
- 첫 owner-conflict 입력에서 배송비·KREAM 수수료 조건이 누락되어 추가 unknown 판단이 타당했다. 해당 8회를 모델 실패로 계산하지 않고 제외했다. 입력을 명시한 뒤 네 설정 모두 2회씩 다시 실행했다. 총 호출은 56회, 평가 대상은 48회다. 원본 기록은 보존했다.

## 결과

모든 셀에서 4/4 통과. 아래는 전체 도구 왕복을 포함한 실행시간 중앙값(초)이다.

| 역할 | Luna/medium | Luna/high | Sol/medium | Sol/high | 적용 |
|---|---:|---:|---:|---:|---|
| 지휘자 | 8.94 | 10.69 | 9.20 | 8.58 | Sol/high |
| 상품 판단 | 10.53 | 13.57 | 12.33 | 12.12 | Luna/medium |
| 독립 검수 | 10.44 | 12.07 | 10.52 | 11.13 | Luna/medium 유지 |

지휘자와 상품 판단은 이전 설정 대비 각각 약 19.7%, 22.4% 짧았다. 작은 합성 표본이므로 통계적 우위, 실상품 판단 정확도, 운영 SLA를 입증하지 않는다. 캐시·네트워크·동시 실행의 영향을 포함한다. 토큰 수는 기록했지만 청구 비용으로 환산하지 않았다. 연구 역할과 모든 조합의 reasoning effort는 별도로 평가하지 않았다.

## 적용 구조

Herdr는 지휘자와 배치 워커를 관리한다. 워커 내부에서 상품 담당자와 검수자는 별도 Codex 스레드로 실행된다. 검수자마다 별도 Herdr pane을 생성하지 않는다.

기본값은 측정 정책으로 정한다. 상품 담당자는 실제 근거 ID와 이유를 제시해 Sol/high 전환을 요청할 수 있다. 호스트가 기존 턴 종료 후 저장 자료를 새 스레드에 인계한다. 이전 담당자의 권한을 회수하고 승격은 1회로 제한한다. 자료 부족 자체는 승격 사유가 아니다. 지휘자도 같은 전환 기능을 갖지만 현재 기본값이 이미 Sol/high이므로 추가 승격하지 않는다.

adopt, `needsDeepReview=true`, 동일 근거에 대한 이전 rework는 독립 Sol/high 검수를 배정한다. 최종 판단은 검수받은 proposal과 일치해야 한다. 모델 전환으로 STOP, 작업량, 원자료, 도구·턴 예산을 초기화하지 않는다. 재개 시 저장된 모델을 유지한다. 배포 전에 시작된 프로세스에는 정책이 소급 적용되지 않는다.

## 재현과 증거

프로젝트 루트에서 실행한다. 별도 출력 디렉터리를 사용하며 기존 실험 파일을 덮어쓰지 않는다.

```powershell
node automation/model-experiments/run.mjs --out=kream-runs/model-placement-new
node --test automation/agent-team/model-routing.test.mjs automation/agent-team/run.test.mjs automation/herdr-runtime/runtime.test.mjs
node automation/agent-team/verify-batch.mjs --out=kream-runs/model-placement-integration-new
node automation/herdr-runtime/verify-live.mjs
```

`finalize.mjs`는 이번 날짜의 원본 48회와 명확화 8회를 합쳐 정책을 생성하는 전용 스크립트다. 향후 실험에는 경로와 사례 변경 이력을 먼저 수정해야 한다.

원본: `kream-runs/model-placement-20261126/`, 보완: `kream-runs/model-placement-20261126-clarified/`, 집계: 원본 폴더의 `final-report.json`.

실제 모델 통합 검사에서 새 도구의 canonical/legacy 등록 형식 혼용을 발견하고 수정했다. 수정 전 실패는 `model-placement-integration-20261126`에 보존했다. 수정 후 `model-placement-integration-20261126-fixed/verification.json`은 가상 상품 2개의 독립 검수와 결과 저장 완료(hold, exclude)를 기록한다. 실상품 수익 검증 결과가 아니다.

최종 검증: 관련 Node 테스트 58/58 통과. Herdr 실제 Sol/high 지휘자의 구조화된 종료는 kream-runs/herdr-validation/1795673515206/verified.json 및 state.json에 기록했다. 실제 상품 수집 검증은 포함하지 않는다.
