# Dot 메인 커맨더 연결

Dot은 일정, 실행 상태, 장애 대응, 후보 보고를 총괄한다. 이 PC의 Codex CLI와 Cream 파이프라인은 수집·규칙 검증·AI 검토·HTML/엑셀 생성을 실행한다. No1 Seller Center는 최종 옵션별 교차 검증 자료를 제공한다.

## Dot에 줄 운영 지시

아래 내용을 이 PC에 연결된 Dot의 책임으로 등록한다. Dot의 로컬 Codex 작업은 이 프로젝트를 작업 폴더로 사용한다.

> Cream 소싱의 메인 커맨더로 일해 줘. 매일 한국 시간 기준 실행 상태를 `node automation/commander.mjs status`로 확인하고, 실패하면 `doctor`로 원인을 조사해. 필요할 때만 `start`로 로컬 반복 실행을 시작해. `STOP`, 사이트 차단, Codex 사용량 제한, 오래된 가격/재고, No1 관측 누락을 무시하거나 후보를 승격하지 마. 실행 결과는 `automation-final.json`과 `automation-report.html`을 읽어 상품 수·후보 수·보류 사유·AI 사용량을 요약해. 구매·입찰·송장·리뷰 제출은 실행하지 마. Chrome 확장 또는 No1의 접근이 필요하면 나에게 구체적인 조치만 요청해. 프로젝트 경로는 `C:\Users\SSAFY\Desktop\N8N\portable\Cream-other-pc-20261109-final\Cream`이다.

## 로컬 명령 인터페이스

```powershell
node automation/commander.mjs doctor
node automation/commander.mjs status
node automation/commander.mjs smoke
node automation/commander.mjs start
node automation/commander.mjs stop
node automation/commander.mjs reset-stop
```

`smoke`는 실전 상품 3개를 수집·검증한다. `start`는 일일 반복 프로세스를 백그라운드로 띄운다. `stop`은 현재 실행에도 `STOP` 파일을 전달한다. 실행이 종료된 뒤 `reset-stop`으로 다음 실행을 허용한다. Dot이 접속할 PC는 ChatGPT 데스크톱 앱에서 연결되어 있어야 한다. Dot의 클라우드 브라우저는 로컬 Chrome 로그인 상태를 물려받지 않으므로 웹 수집 실행기는 이 PC에 둔다.

Dot 자체 생성·PC 연결·지시 등록은 ChatGPT UI에서 이루어진다. 2026-11-09에 기존 `내 dot`에 메인 커맨더 지시를 전달했고, Dot이 연결된 이 PC에서 `doctor`·`status`·`smoke`·`start`를 직접 실행했다. Dot이 실행한 실전 `smoke`는 상품 3개를 분석해 3개 제외로 종료하고 HTML·엑셀을 생성했다. 최초 일괄 수집 주기는 보존한 채 중단하고, 현재 5개 단위 `cycle-02`가 실행 중이다. Dot의 정기 점검은 매일 한국시간 오전 9시로 활성화됐고 다음 실행은 2026-11-10 09:00이다. [Dot 시작 안내](https://learn.chatgpt.com/docs/dots/getting-started), [컴퓨터 연결 안내](https://learn.chatgpt.com/docs/dots/computers-and-apps).

2026-11-09 사용자 지시로 현재 `cycle-02`는 **100개 한 번만 처리**한다. 앞서 완료한 25개를 유지하고 첫 100개 ID만 현재 실행 대상으로 남겼다. 원래 500개 목록과 배치 명세는 같은 실행 폴더의 `k50-ids-full.json`·`batches-full.json`에 보관했다. `loop-config.json`의 `runOnce: true`로 100개 완료 후 루프가 종료된다. 완료 상태에서 `commander.mjs start`는 `already-complete`를 반환하므로 정기 점검에서 다시 시작하지 않는다. 추가 실행은 사용자의 새 지시가 있을 때만 설정을 바꿔 진행한다.

Codex CLI가 Dot 실행 환경의 `PATH`에 없어도 `automation/codex-cli.mjs`가 설치된 VS Code 확장에서 실행 파일을 찾아 사용한다. `doctor`는 현재 `codexSignedIn: true`를 반환한다. No1 Seller Center의 동일 옵션 관측을 자동 공급하는 경로는 아직 확인되지 않았으며, 관측이 없으면 후보 승격은 차단된다.

## Dot 직접 스크리닝

500개 일괄 수집은 10분 시세 유효기간을 넘겨 2026-11-09에 중단했다. 기존 500개 ID를 보존해 `cycle-02`부터 5개씩 수집→네이버→판매처→감사를 완료한다. 완료 배치는 `batches.json`에 표시되고, 상위 `automation-final.json`·`dot-screening-queue.json`에 누적된다. Dot은 후보·보류를 먼저, 제외 항목 일부를 표본으로 원본 덤프와 대조한다. 독립 판단은 `dot-screening-batch-001.json`처럼 배치별 근거와 이유를 남기며, 기존 제외를 자동 승격하지 않는다. 매일 09:00 KST 점검 예약에도 미검토 배치 스크리닝이 추가됐다.
