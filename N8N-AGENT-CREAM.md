# Agent Cream n8n 설계

`n8n-agent-cream-workflow.json`은 `KREAM-리셀-파이프라인-최종기획안.md`의 파일럿 범위를 n8n 오케스트레이션으로 옮긴 가져오기용 워크플로다.

## 실행 흐름

1. 수동 실행 또는 매일 09:00(KST) 스케줄로 시작한다.
2. 실행 ID, 프로젝트 경로, 파일럿 범위를 고정한다.
3. 기존 `pilot.py`를 실행한다.
4. stdout의 `엑셀경로 탐색대상수 관측수`를 구조화한다.
5. 성공과 실패를 분기한다. 실패 시 `stderr`와 재실행 안내를 실행 데이터에 남긴다.

워크플로는 자동 주문, 입찰, 메시지 전송을 하지 않는다. KREAM과 네이버의 자동 수집도 공식 권한과 데이터 범위가 확인되기 전까지 포함하지 않는다.

## 가져오기와 검증

1. self-hosted n8n에서 **Import from File**로 `n8n-agent-cream-workflow.json`을 선택한다.
2. 워크플로 시간대가 `Asia/Seoul`인지 확인한다.
3. `파일럿 CLI 실행` 노드의 Python 및 프로젝트 절대 경로가 n8n 실행 계정에서도 유효한지 확인한다.
4. 워크플로를 활성화하기 전에 `수동 실행`으로 한 번 검증한다.
5. 성공 출력의 `output_xlsx` 파일에서 후보, 관찰·보류, 근거·실행 시트와 회귀 검산값을 확인한다.

`Execute Command`는 n8n Cloud에서 제공되지 않으며, self-hosted 환경에서도 보안상 비활성화할 수 있다. 이 경우 Python CLI를 별도 내부 서비스로 감싸고 해당 노드를 HTTP Request 노드로 교체해야 한다.
