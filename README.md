# 박한수 에이전트 대쉬보드

Windows에서 대시보드는 일반 데스크톱 창으로 열리고, 제임스와 검토자·감사총무는 백그라운드 CLI에서 작업합니다. KREAM 인기순·무신사 랭킹·네이버 가격비교의 실행 코드와 역할별 토큰 집계가 한 저장소에 들어 있습니다.

## 다른 PC에서 시작하기

[2026년 11월 22일 Windows 설치·복원·실행 안내](docs/2026-11-22-windows-handoff.md)를 따릅니다. 기존 채팅과 탐색 위치를 이어받으려면 개인 ZIP을 설치 전에 복원합니다. 안내의 1~4단계는 대시보드와 상품 탐색을 켜지 않고 진행할 수 있습니다.

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
