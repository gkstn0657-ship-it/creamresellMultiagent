# 다른 Windows PC에서 설치하고 기존 작업 이어받기

작성일 **2026년 11월 22일 (한국시간)**. 새 PC에서 대시보드와 에이전트를 설치하고, 기존 채팅·취향·탐색 위치를 이어받는 절차입니다. **4단계까지는 대시보드와 상품 탐색을 꺼 둔 상태로 진행합니다.**

## 1. 새 PC에 코드 받기

Git, Node.js 24, Python 3.10 이상과 Windows용 `py` 런처를 준비합니다. 대시보드 창은 Edge 또는 Chrome을 사용하고, 소싱 확장 프로그램은 Chrome에 설치합니다. PowerShell에서 실행합니다.

```powershell
git clone https://github.com/gkstn0657-ship-it/creamresellMultiagent.git
cd creamresellMultiagent
git rev-parse --short HEAD
```

이미 이 저장소를 복제한 PC에서는 해당 폴더에서 `git status --short --branch`로 자신의 변경을 확인하고 `git pull --ff-only origin main`으로 업데이트합니다. 이후 명령은 모두 복제한 폴더에서 실행합니다.

## 2. 기존 채팅과 탐색 위치 복원

현재 PC에서 새 PC로 **개인 이전 ZIP**을 직접 복사합니다. 11월 22일 이전본의 파일명은 `Cream-private-state-20261122-final.zip`입니다. 아래 경로를 실제 파일 위치로 바꾸고 **설치와 최초 실행 전**, 빈 데이터 위치에서 복원합니다. 이력이 필요 없는 새 설치는 3단계로 이동합니다.

```powershell
$creamArchive = 'D:\Cream-private-state-20261122-final.zip'
py -3 -X utf8 tools/state_transfer.py verify $creamArchive
py -3 -X utf8 tools/state_transfer.py restore $creamArchive
```

두 명령에서 `verified: true`를 확인합니다. 복원기는 팀보드 DB, 네이버 매입처 기록, KREAM·무신사의 작업 번호와 중복 이력, 일별 보고서, 개인 설정을 읽고 등록된 네이버 경로를 새 PC에 맞춥니다. 기존 파일과 충돌하면 해당 경로를 표시하고 중단합니다. `STOP`과 작업별 날짜 보고 설정도 보존합니다.

## 3. 설치하고 오프라인으로 점검

```powershell
.\Setup-Other-PC.ps1
.\Test-Other-PC.ps1
node automation/agent-team/register-mcp.mjs --check
```

첫 명령은 프로젝트 안의 `.venv`에 Python 의존성을 설치합니다. 두 번째 명령은 예제 자료로 판정·엑셀·팀보드 기능을 점검합니다. 마지막 명령은 임시 로컬 MCP 프로세스에서 도구 목록과 패널을 읽고 종료합니다. 브라우저 회귀 테스트용 의존성까지 설치할 때는 설치 명령에 `-WithBrowserTests`를 붙입니다.

## 4. 중단 상태 확인

복원한 원장의 중단 표시와 운영 포트를 PowerShell에서 확인할 수 있습니다.

```powershell
Get-ChildItem .\kream-runs -Filter STOP -File -Recurse | Select-Object -ExpandProperty FullName
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 48731, 8871, 8787 } |
    Select-Object LocalPort, OwningProcess
```

팀보드는 48731, No1 브리지는 8871, 네이버 릴레이는 8787을 사용합니다. 서비스를 꺼 둔 PC에서는 해당 포트 목록이 비어 있습니다. 중단 상태로 인계할 때는 여기서 마칩니다.

## 5. 새 PC를 운영할 때

1. 새 PC의 Codex CLI에 본인 계정으로 로그인하고 `node automation/agent-team/register-mcp.mjs --register`를 실행한 다음 Codex를 다시 엽니다. `no1`과 `cream_team`이 이 복제본의 절대경로로 등록됩니다.
2. Chrome 확장 관리에서 개발자 모드를 켜고 `automation/no1-background/chrome-extension`과 `naver-extension`을 각각 **압축해제된 확장 프로그램 로드**로 추가합니다. 새 PC의 No1 Seller Center와 Onebox, 사용하는 KREAM·무신사·네이버 계정에 로그인합니다.
3. `.\automation\no1-background\start-bridge.ps1`로 브리지를 켠 뒤 `.\automation\no1-background\copy-pairing-code.ps1`를 실행하고 No1 확장 팝업에 붙여 넣습니다. 원격 Dot을 사용한다면 해당 계정의 비공개 원격 연결도 설정합니다. [No1 연결 안내](../automation/no1-background/README.md) · [원격 연결 안내](../OTHER-PC-20261110.md)
4. `.\Start-TeamBoard.cmd`로 대시보드 창을 엽니다. 이 명령은 팀보드 서버와 대기 업무 처리기도 시작합니다. 창을 닫은 뒤에도 서버는 실행될 수 있습니다.
5. 탐색을 이어갈 때는 이전 PC의 워커가 꺼져 있는지 확인하고 **새 PC 한 곳에서만** 기존 작업 번호와 남은 수량을 지정해 재개합니다. 두 PC의 복사된 원장은 이후 각자 갱신됩니다.

공개 Git에는 실행 코드와 테스트가 있습니다. 개인 ZIP은 별도로 보관합니다. 로그인 세션·페어링 키·원격 Dot 인증은 새 PC에서 연결합니다. 운영 데이터 위치와 백업 명령은 [저장소 안내](../README.md#운영-파일)에서 확인할 수 있습니다.
