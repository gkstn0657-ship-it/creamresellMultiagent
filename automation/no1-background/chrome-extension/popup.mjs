const status = document.querySelector('#status');
const messages = {CONNECTED: '로컬 연결 완료 · No1 응답은 테스트할 때 확인합니다', VERIFIED_READ: 'No1 조회 응답 확인 완료', DISCONNECTED: '연결 해제됨', NO1_BRIDGE_UNAVAILABLE: '로컬 연결기 실행과 연결 코드를 확인하세요', NO1_AUTH_REQUIRED: '기존 No1 웹 탭에서 로그인 상태를 확인하세요', NO1_WEB_TAB_REQUIRED: '로그인된 No1 웹 탭을 열어 두세요', NO1_MULTIPLE_WEB_SESSIONS: '서로 다른 No1 로그인 탭이 있어 계정을 선택해야 합니다', INVALID_PAIRING_CODE: '연결 코드가 올바르지 않습니다'};
function show(code) { status.textContent = messages[code] || `확인 필요: ${code}`; }
async function refresh() { const {lastStatus} = await chrome.storage.local.get('lastStatus'); show(lastStatus || 'DISCONNECTED'); }
document.querySelector('#connect').addEventListener('click', async () => {
  const input = document.querySelector('#key');
  const result = await chrome.runtime.sendMessage({type: 'connect', key: input.value.trim()});
  input.value = ''; show(result.ok ? 'CONNECTED' : result.code);
});
document.querySelector('#disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({type: 'disconnect'}); show('DISCONNECTED'); });
chrome.storage.onChanged.addListener(() => { void refresh(); });
void refresh();
