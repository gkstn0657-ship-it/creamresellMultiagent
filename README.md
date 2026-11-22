# 박한수 에이전트 대쉬보드

Windows에서 대시보드는 일반 데스크톱 창으로 열리고, 제임스와 검토자·감사총무는 백그라운드 CLI에서 작업합니다. KREAM 인기순·무신사 랭킹·네이버 가격비교의 실행 코드와 역할별 토큰 집계가 한 저장소에 들어 있습니다.

## 다른 PC에서 시작하기

1. Git, Node.js 24, Python 3.10 이상, Chrome을 설치합니다. Python 설치 시 Windows용 `py` 런처를 포함합니다. 라이브 에이전트 실행에는 해당 PC에 로그인한 Codex CLI가 필요합니다.
2. PowerShell에서 저장소를 복제합니다.

   ```powershell
   git clone https://github.com/gkstn0657-ship-it/creamresellMultiagent.git
   cd creamresellMultiagent
   ```

3. **기존 PC에서 이어서 사용할 경우** 개인 이전 ZIP을 새 PC에 직접 복사하고, 설치나 대시보드 첫 실행 전에 복원합니다. 경로는 실제 ZIP 위치로 바꿉니다. 빈 데이터 폴더에서 새로 시작할 때는 다음 단계로 넘어갑니다.

   ```powershell
   py -3 -X utf8 tools/state_transfer.py restore "D:\Cream-private-state-20261122.zip"
   ```

   복원기는 SHA-256을 검증하고 기존 채팅·취향·판정·역할별 사용 기록·한국 날짜별 보고서·탐색 위치를 복사합니다. 기존 데이터가 있으면 충돌 위치를 표시하고 중단합니다. 등록된 네이버 작업 폴더는 새 위치로 연결하고, 운영 중단 표시는 보존합니다. 이 ZIP은 개인 정보와 영업 기록이 들어 있는 파일입니다.

4. 설치 및 오프라인 점검을 실행합니다. `Setup`은 프로젝트의 `.venv`에 Python 패키지를 설치합니다. `Test`는 저장 예제와 임시 작업 폴더로 판정·엑셀·팀보드를 확인합니다.

   ```powershell
   .\Setup-Other-PC.ps1
   .\Test-Other-PC.ps1
   node automation/agent-team/register-mcp.mjs --check
   .\Start-TeamBoard.cmd
   ```

5. **라이브 작업 연결**에 사용할 Codex CLI에서 로그인한 뒤 아래 명령으로 이 복제본의 두 로컬 MCP를 등록하고 Codex를 다시 엽니다.

   ```powershell
   node automation/agent-team/register-mcp.mjs --register
   .\automation\no1-background\start-bridge.ps1
   .\automation\no1-background\copy-pairing-code.ps1
   ```

   Chrome의 확장 관리에서 개발자 모드를 켜고 `automation/no1-background/chrome-extension`과 `naver-extension`을 각각 **압축해제된 확장 프로그램 로드**로 등록합니다. 새 PC에서 No1 Seller Center와 Onebox, 사용하는 판매처에 로그인하고 No1 확장 팝업에 이 PC의 페어링 코드를 붙여 넣습니다. No1의 내부 KREAM·무신사 연결도 확인합니다. 원격 Dot을 사용할 때는 해당 계정의 비공개 연결 설정을 별도로 구성합니다. [No1 연결 안내](automation/no1-background/README.md) · [원격 Dot 연결](OTHER-PC-20261110.md)

## 운영 파일

| 내용 | 기본 위치 |
|---|---|
| 작업 방식과 변경 이력 | [작업방식](docs/작업방식.md) |
| 대시보드 채팅·작업 DB | `runs/team-board/board.sqlite3` |
| KREAM·무신사 커서와 상품별 검토 근거 | `kream-runs/agent-teams/` |
| 네이버 실행 원장 | `kream-runs/<날짜>-naver-*/` |
| 상품 탐색 보고서 | `상품탐색결과/YYYY-MM/YYYY-MM-DD.md` |
| 취향 보관함·개인 프로필 | `%APPDATA%\Agent Mission Control\Personal Library` |

Git에는 코드·테스트·운영 기준을 저장합니다. 개인 원장은 탐색을 중단한 뒤 `py -3 -X utf8 tools/state_transfer.py export "D:\Cream-private-state.zip"`으로 별도 보관할 수 있습니다. 기본 위치를 변경한 설치는 `export --help`에서 각 데이터 경로를 지정합니다. 계정 로그인, 브라우저 프로필, Codex 사용자 세션과 연결 키는 대상 PC에서 설정합니다.
