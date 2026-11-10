> **2026-11-10 이전 안내:** 이 문서는 과거 기록입니다. 현재 백그라운드 No1·고정 순환 탐색 이전은 [OTHER-PC-20261110.md](OTHER-PC-20261110.md)를 먼저 따르세요. 아래의 No1 창 복원·화면 조회·옛 탐색 시작 지시는 현재 운영에 적용하지 않습니다.

# 다른 PC에서 시작

이 묶음은 2026-11-08 작업을 중단한 시점의 전체 프로젝트와 기록이다. 새 PC는 Windows 기준이다. ZIP을 **새 빈 폴더**에 풀고 그 폴더에서 PowerShell을 연다. 예전 `README-kream.md`보다 이 안내를 먼저 따른다.

## 처음 한 번

1. Node.js 20 이상, Python, Chrome을 설치한다. Python은 PATH를 사용할 수 있어야 한다.
2. 다음 명령으로 Python 가상환경·의존성·현재 PC 경로를 설정한다. 설치에는 인터넷이 필요하다.

```powershell
.\Setup-Other-PC.ps1
.\Test-Other-PC.ps1
```

3. Chrome 주소창에 `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → **현재 폴더 바로 아래 `naver-extension`**을 선택한다. `renew/Cream/naver-extension`은 과거 사본이다.
4. 새 Chrome에서 KREAM·네이버에 직접 로그인한다. Naver Price Dumper 팝업의 자동 실행 설정을 확인한다. ChatGPT의 브라우저 제어 연결은 이 수집 방식에 필요하지 않다.
5. AI 검토를 실행하려면 새 PC의 Codex CLI를 설치하고 본인 계정으로 로그인한다. 모델은 `gpt-6.1-sol`, reasoning은 `high`로 지정되어 있다. Codex 앱만 있고 `codex` 명령이 없다면 CLI 설정도 필요하다. Claude Code를 쓰는 경우 `.claude` 정의도 포함되어 있다.

스크립트 실행이 Windows 정책으로 막히면 이 폴더를 신뢰할 수 있는지 확인하고 Windows의 파일 차단 해제 절차를 따른다. 스크립트는 PC 전체 실행 정책을 변경하지 않는다.

## 다음 작업

개발을 재개할 때는 `HANDOFF-NEXT-PC.md`를 먼저 읽는다. 마지막 지시는 **개발 중단 후 PC 이전 준비**였으며, 개발 완료로 표시하지 않았다. 전체 실전 탐색의 마지막 검증이 남아 있다.

명시적으로 탐색을 시작할 때 사용하는 진입점:

```powershell
.\Start-Relay.ps1
.\Start-Sourcing.ps1 -Limit 30
```

새 실행은 `kream-runs/<시각>-team`에 저장한다. 릴레이는 새 PC용 빈 `kream-runs/pc-relay`를 사용한다. 과거 작업 큐를 자동 재실행하지 않는다. 기존 8787 프로세스가 있으면 연결 폴더를 확인하며, 다른 프로세스를 종료하지 않는다. `STOP`은 자동 해제하지 않는다.

새 셸에서 Node 명령을 직접 실행할 때는 먼저 `. .\Use-Cream.ps1`로 이 프로젝트의 Python 가상환경 경로를 적용한다. 저장 자료 재생은 `Start-Sourcing.ps1 -RunDir <저장폴더> -Replay`이며 사이트 접속과 AI 모델 호출을 하지 않는다. 자료 구성이 다른 과거 실행은 아래 인수인계의 재생 주의사항을 확인한다.

## 포함된 작업

- 루트와 `renew/Cream`의 파이프라인 코드·시험·문서, 6개 Codex/Claude 에이전트 정의
- `kream-runs`, `renew/agent-verification-20261108`의 수집 원본·검증 결과·진행 기록
- `outputs`, `sites`의 엑셀·HTML·배포 소스, 북마크와 이전 설계 자료
- 사용자 조건: 개당 100만 원 이하, 총 예산 제한 없음, 여러 개 매입, 네이버 스토어 우선, 판매 수수료율 6%. 상세 비용 가정은 `sourcing-policy.json` 참조
- Node 스크립트의 외부 npm 의존성은 없다. 기존 `node_modules` 연결은 제외하고 Python 의존성은 새 PC에서 설치한다.

로그인 세션·브라우저 프로필·계정 토큰·기존 `.env.naver`는 옮기지 않는다. 네이버 쇼핑 검색 API는 서비스 종료로 사용하지 않으므로 이전 API 키는 필요 없다. 덤프·북마크·로그에 개인 정보가 포함될 수 있으므로 이 전체 묶음은 개인 이전용으로 보관한다.

## HTML·엑셀·n8n

기존 HTML은 `kream-runs`와 `sites/cream-sourcing-report/dist`, 엑셀은 `outputs`·각 실행 폴더에 있다. 파일을 바로 열 수 있다. `sites`의 배포 URL은 이전 배포의 기록이며 재배포 권한은 새 PC에서 다시 연결한다.

n8n은 선택 사항이다. Docker Desktop을 사용하는 경우 `docker compose -f docker-compose.portable.yml up -d --build`로 시작하고 `http://localhost:5678`에서 `n8n-agent-cream-docker.json`을 가져온다. Windows의 기존 self-hosted n8n을 쓰는 경우 Setup이 생성한 `n8n-agent-cream-this-pc.json`을 가져온다. 두 워크플로 모두 비활성 상태이며 기존 `pilot.py`용으로, 새 6개 역할의 전체 탐색 진입점과는 별도다. 프로젝트 밖 `E:/AgentCream/n8n-data`의 계정·실행 DB와 Docker 볼륨은 이 묶음에 포함되지 않는다.

ZIP 안의 `TRANSFER-MANIFEST.json`은 포함 파일별 SHA-256과 제외 목록이다. `python tools/pack_workspace.py --verify <ZIP경로>`로 전송 중 손상을 확인할 수 있다.
