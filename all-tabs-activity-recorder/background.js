const STATE_KEY = "recorderState";
const MAX_EVENTS_PER_SESSION = 20_000;

const emptyState = () => ({ activeSessionId: null, sessions: [] });
let state = emptyState();
const ready = chrome.storage.local.get(STATE_KEY).then((stored) => {
  state = { ...emptyState(), ...(stored[STATE_KEY] || {}) };
});

const currentSession = () => state.sessions.find((session) => session.id === state.activeSessionId) || null;
const safeUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};
const persist = () => chrome.storage.local.set({ [STATE_KEY]: state });

async function record(type, data = {}) {
  const session = currentSession();
  if (!session || !session.isRecording) return false;
  if (session.events.length >= MAX_EVENTS_PER_SESSION) {
    if (!session.limitReached) {
      session.limitReached = true;
      session.events.push({ at: new Date().toISOString(), type: "event_limit_reached", limit: MAX_EVENTS_PER_SESSION });
      await persist();
    }
    return false;
  }
  session.events.push({ at: new Date().toISOString(), type, ...data });
  await persist();
  return true;
}

async function tabSnapshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { tabId, url: safeUrl(tab.url), windowId: tab.windowId };
  } catch {
    return { tabId };
  }
}

async function notifyTab(tabId, type) {
  try {
    await chrome.tabs.sendMessage(tabId, { type });
  } catch {
    // Chrome-internal, protected, and still-loading pages cannot receive messages.
  }
}

async function injectRecorder(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] });
    await notifyTab(tabId, "RECORDER_START");
  } catch {
    // Restricted Chrome pages are outside extension access.
  }
}

async function startRecording() {
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    isRecording: true,
    limitReached: false,
    events: []
  };
  state.sessions.push(session);
  state.activeSessionId = session.id;
  await record("session_started", { source: "extension" });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await record("tab_observed", { source: "extension", ...(await tabSnapshot(tab.id)) });
    await injectRecorder(tab.id);
  }
  await persist();
}

async function stopRecording() {
  const session = currentSession();
  if (!session?.isRecording) return;
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => notifyTab(tab.id, "RECORDER_STOP")));
  await record("session_stopped", { source: "extension" });
  session.isRecording = false;
  session.stoppedAt = new Date().toISOString();
  state.activeSessionId = null;
  await persist();
}

function exportData() {
  return { exportedAt: new Date().toISOString(), sessions: state.sessions };
}

function eventTarget(event) {
  if (!event.target) return "";
  return [event.target.tag, event.target.role, event.target.inputType].filter(Boolean).join(" · ");
}

function toMarkdown() {
  const lines = ["# Chrome 전체 탭 행동 기록", "", `- 내보낸 시각: ${new Date().toISOString()}`, `- 세션: ${state.sessions.length}개`];
  for (const [index, session] of state.sessions.entries()) {
    lines.push("", `## 세션 ${index + 1}`, "", `- ID: \`${session.id}\``, `- 시작: ${session.startedAt}`, `- 종료: ${session.stoppedAt || "진행 중"}`, `- 이벤트: ${session.events.length}개`, "", "| 시각 | 탭 | 행동 | 대상 | URL |", "| --- | --- | --- | --- | --- |");
    for (const event of session.events) {
      lines.push(`| ${event.at} | ${event.tabId ?? ""} | ${event.type} | ${eventTarget(event).replaceAll("|", "\\|")} | ${(event.url || "").replaceAll("|", "%7C")} |`);
    }
  }
  lines.push("", "## 원시 기록", "", "```json", JSON.stringify(exportData(), null, 2), "```");
  return lines.join("\n");
}

async function download(filename, content, mimeType) {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({ url, filename, saveAs: true });
}

function publicState() {
  const session = currentSession();
  return {
    isRecording: Boolean(session?.isRecording),
    activeSession: session ? { id: session.id, startedAt: session.startedAt, eventCount: session.events.length } : null,
    sessionCount: state.sessions.length
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ready;
    switch (message.type) {
      case "GET_STATE":
        sendResponse({ state: publicState() });
        break;
      case "START":
        if (!currentSession()?.isRecording) await startRecording();
        sendResponse({ state: publicState() });
        break;
      case "STOP":
        await stopRecording();
        sendResponse({ state: publicState() });
        break;
      case "CLEAR":
        state = emptyState();
        await persist();
        sendResponse({ state: publicState() });
        break;
      case "EXPORT_JSON":
        await download("chrome-activity-log.json", JSON.stringify(exportData(), null, 2), "application/json");
        sendResponse({ ok: true });
        break;
      case "EXPORT_MARKDOWN":
        await download("chrome-activity-log.md", toMarkdown(), "text/markdown");
        sendResponse({ ok: true });
        break;
      case "PAGE_EVENT":
        await record(message.eventType, { ...message.data, tabId: sender.tab?.id, frameId: sender.frameId });
        sendResponse({ ok: true });
        break;
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onCreated.addListener(async (tab) => {
  await ready;
  await record("tab_created", { source: "chrome", ...(await tabSnapshot(tab.id)) });
});
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await ready;
  await record("tab_closed", { source: "chrome", tabId, ...removeInfo });
});
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await ready;
  await record("tab_activated", { source: "chrome", windowId, ...(await tabSnapshot(tabId)) });
});
chrome.webNavigation.onCommitted.addListener(async (details) => {
  await ready;
  if (details.frameId === 0) await record("navigation_committed", { source: "chrome", tabId: details.tabId, url: safeUrl(details.url), transitionType: details.transitionType });
});
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  await ready;
  if (details.frameId === 0) await record("history_state_updated", { source: "chrome", tabId: details.tabId, url: safeUrl(details.url), transitionType: details.transitionType });
});
