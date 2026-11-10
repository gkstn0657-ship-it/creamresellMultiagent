const $ = (id) => document.getElementById(id);

async function request(type) {
  return chrome.runtime.sendMessage({ type });
}

function render(state) {
  $("status").textContent = state.isRecording ? "● 기록 중: 모든 탭" : "○ 기록 대기";
  $("meta").textContent = state.activeSession
    ? `시작: ${new Date(state.activeSession.startedAt).toLocaleString()} · 이벤트 ${state.activeSession.eventCount}개 · 보관 세션 ${state.sessionCount}개`
    : `보관 세션 ${state.sessionCount}개`;
  $("start").disabled = state.isRecording;
  $("stop").disabled = !state.isRecording;
}

async function refresh() {
  const { state } = await request("GET_STATE");
  render(state);
}

$("start").addEventListener("click", async () => render((await request("START")).state));
$("stop").addEventListener("click", async () => render((await request("STOP")).state));
$("clear").addEventListener("click", async () => render((await request("CLEAR")).state));
$("json").addEventListener("click", () => request("EXPORT_JSON"));
$("markdown").addEventListener("click", () => request("EXPORT_MARKDOWN"));
refresh();
