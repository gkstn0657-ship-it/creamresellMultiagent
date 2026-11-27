(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const roles = {worker: "제임스", reviewer: "클레어", auditor: "모건", contractor: "계약직", user: "나"};
  const avatars = {worker: "제", reviewer: "클", auditor: "모", contractor: "계", user: "나"};
  const legacyNames = {실무자: roles.worker, 검토자: roles.reviewer, 감사총무: roles.auditor};
  const states = {ready: "대기", running: "진행 중", blocked: "확인 필요", done: "완료", unconfirmed:"실행 확인 중"};
  const kinds = {
    request: "새 요청", note: "추가 지시", start: "작업 시작", progress: "진행 상황",
    files: "산출물", submit: "결과 제출", approve: "검토 통과", revise: "보완 요청",
    close: "감사 마감", retry: "다시 실행", blocked: "확인 필요", error: "실행 오류", escalate: "중요 장애 이관",
    interrupt: "실행 중단", draft: "중간 결과",
    contract_start: "계약직 업무 의뢰", contract_result: "계약 결과 제출",
    contract_accept: "계약 결과 검수 통과", contract_reject: "계약 결과 반려",
    ask: "협의 요청", answer: "협의 답변",
    contract_interrupt: "계약 업무 중단",
  };
  const dateFormat = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
  });
  const timeFormat = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const dayKeyFormat = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const feed = byId("chat-feed");
  const clockFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const input = byId("message");
  const mode = byId("chat-mode");
  const scopeSelect = byId("chat-scope");
  const jump = byId("new-messages");
  const timeline = [];
  const latestByCard = new Map();
  const contractedCards = new Set();
  const storageKey = "team-board-composer-v1";
  let restored = {};
  try { restored = JSON.parse(sessionStorage.getItem(storageKey)) || {}; } catch { /* Private browsing. */ }
  const drafts = new Map(Object.entries(restored.drafts || {}));
  const outbox = new Map((restored.outbox || []).map(message => [message.id, {
    ...message, status: message.status === "sending" ? "uncertain" : message.status,
  }]));
  const ownByScope = new Map();
  const latestOwnButton = byId("my-latest");
  let latestOwn;
  function saveComposer() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({
        scope, mode: mode.value, drafts: Object.fromEntries(drafts), outbox: [...outbox.values()],
      }));
    } catch { /* The active page still holds drafts and undelivered messages. */ }
  }
  const pendingRequests = new Map();
  const retrying = new Set();
  let cards = [];
  let externalActivities = [];
  let cursor = 0;
  let scope = restored.scope || "all";
  let filter = "all";
  let online = false;
  let sending = false;
  let group = null;
  let lastDay = "";
  let draftKey = restored.mode === "note" && scope !== "all" ? "note-" + scope : "new";
  mode.value = draftKey === "new" ? "new" : "note";
  input.value = drafts.get(draftKey) || "";
  let unread = 0;
  let syncInFlight;
  let cardSignature;
  let scopeSignature;

  function renderClock() {
    const now = new Date();
    byId("clock").textContent = clockFormat.format(now) + " KST";
    byId("clock").dateTime = now.toISOString();
    byId("today").textContent = dateFormat.format(now);
  }

  function renderFocus(pulse = false) {
    const active = online ? cards.filter(card => card.state === "running") : [];
    const rolesInUse = active.map(card => card.stage === "worker" && contractedCards.has(card.id) ? "contractor" : card.stage);
    const sources = online ? [...new Map(externalActivities.map(item=>[item.id,item])).values()].filter(item => item.state === "running" && !["waiting","blocked","done"].includes(item.phase)).map(item => ({
      id: item.id,
      phase: item.phase || (/검토|판정/.test(item.detail || "") ? "verify" : "collect"),
    })) : [];
    const workIds = [...new Set([...active.map(card=>card.sourceWorkId || "card:"+card.id), ...sources.map(item=>item.id)])];
    const busy = workIds.length;
    const stalled = [...externalActivities, ...cards].some(item => item.state === "blocked");
    const queued = [...externalActivities, ...cards].some(item => item.state === "ready" || item.phase === "waiting");
    const sourceMood = sources.some(item => item.phase === "collect") ? "sourcing"
      : sources.some(item => item.phase === "verify") ? "reviewer" : "auditor";
    const mode = !online ? "offline" : busy ? (rolesInUse[0] || sourceMood)
      : queued ? "ready" : stalled ? "blocked" : "idle";
    const orb = byId("orb");
    const description = online ? [
      ...new Set(rolesInUse.map(role => roles[role] || role)),
      ...externalActivities.filter(item => item.state === "running").map(item => item.title),
    ].join(", ") : "";
    orb.setAttribute("aria-label", "작업 상태 · " + (description || ({
      offline:"연결 대기", ready:"배정 대기", blocked:"확인 필요", idle:"대기 중",
    })[mode] || "진행 중"));
    orb.dispatchEvent(new CustomEvent("board-activity", {detail:{
      mode, roles:[...new Set(rolesInUse)], sources, workIds, count:busy, pulse:online && pulse,
    }}));
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function mountBriefing() {
    for (const template of document.querySelectorAll("template[data-briefing-template]")) {
      template.replaceWith(template.content.cloneNode(true));
    }

    const briefingDate = new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric",
    });
    const library = byId("heart-library");
    const kindNames = {quote: "글귀와 시", line: "한 줄 글귀", topic: "AI 토픽"};
    let heartRevision = 0;
    let pendingHeart = "";
    let libraryRequest = 0;
    let briefingSignature = "";

    function briefingLink(label, address, className) {
      const url = URL.canParse(address) ? new URL(address) : null;
      if (url?.protocol !== "https:" && url?.protocol !== "http:") return null;
      const link = element("a", className, label);
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    }

    function setHeartState(button, liked) {
      button.setAttribute("aria-pressed", String(liked));
      button.title = liked ? "하트 취소" : "하트로 저장하고 추천에 반영";
    }

    function heartButton(item) {
      const button = element("button", "heart-toggle");
      button.type = "button";
      button.dataset.itemId = item.id;
      button.setAttribute("aria-label", (item.title || item.text) + " 하트");
      setHeartState(button, item.liked);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z");
      svg.append(path);
      button.append(svg);
      return button;
    }

    function updateHeartCount(count) {
      byId("heart-count").textContent = String(count);
    }

    function topicMeta(topic) {
      const published = new Date(topic.publishedAt * 1000);
      const meta = element("span", "brief-topic-meta", topic.source);
      if (Number.isFinite(published.getTime())) {
        const time = element("time", "", briefingDate.format(published));
        time.dateTime = published.toISOString();
        meta.append(" · ", time);
      }
      return meta;
    }

    function showLibraryItems(items) {
      const list = byId("saved-hearts");
      const focused = Array.from(list.querySelectorAll(".heart-toggle")).indexOf(document.activeElement);
      const fragment = document.createDocumentFragment();
      for (const saved of items) {
        const row = element("li", "heart-row");
        const copy = element("div", "");
        copy.append(element("span", "library-type", kindNames[saved.kind]));
        const link = saved.kind === "topic" && briefingLink(saved.title, saved.url, "brief-topic-link library-text");
        copy.append(link || element("p", "library-text", saved.text || saved.title));
        if (saved.kind === "topic") copy.append(topicMeta(saved));
        row.append(copy, heartButton(saved));
        fragment.append(row);
      }
      if (!items.length) fragment.append(element("li", "library-meta", "브리핑에서 하트를 누르면 여기에 계속 보관됩니다."));
      list.replaceChildren(fragment);
      if (focused >= 0) {
        const buttons = list.querySelectorAll(".heart-toggle");
        (buttons[Math.min(focused, buttons.length - 1)] || byId("close-hearts")).focus();
      }
    }

    async function loadLibrary() {
      const request = ++libraryRequest;
      const revision = heartRevision;
      const feedback = byId("library-feedback");
      if (!byId("saved-hearts").childElementCount) feedback.textContent = "보관함을 불러오는 중…";
      try {
        const response = await fetch("/api/briefing/hearts", {cache: "no-store", signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!library.open || request !== libraryRequest || revision !== heartRevision || pendingHeart) return;
        showLibraryItems(data.items);
        const interests = data.interests || [];
        byId("interest-list").replaceChildren(...interests.map((item) => element("li", "", item.label + " · " + item.count)));
        byId("library-interests").hidden = !interests.length;
        updateHeartCount(data.savedCount);
        feedback.textContent = "";
      } catch {
        if (library.open && request === libraryRequest) feedback.textContent = "보관함을 불러오지 못했습니다. 다시 열어 주세요.";
      }
    }

    byId("open-hearts").addEventListener("click", () => {
      byId("saved-hearts").replaceChildren();
      byId("library-interests").hidden = true;
      byId("library-feedback").textContent = "";
      library.showModal();
      loadLibrary();
    });
    byId("close-hearts").addEventListener("click", () => library.close());

    async function toggleHeart(button) {
      if (pendingHeart) return;
      const id = button.dataset.itemId;
      const liked = button.getAttribute("aria-pressed") !== "true";
      pendingHeart = id;
      heartRevision++;
      const controls = document.querySelectorAll(".heart-toggle");
      for (const control of controls) control.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-busy", "true");
      const feedback = byId(library.open ? "library-feedback" : "heart-feedback");
      feedback.textContent = "";
      let acknowledged = false;
      try {
        const response = await fetch("/api/briefing/hearts", {
          method: "POST", headers: {"Content-Type": "application/json", "X-Team-Board": "1"},
          body: JSON.stringify({id, liked}), signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        for (const control of controls) {
          if (control.dataset.itemId === id) setHeartState(control, data.item.liked);
        }
        updateHeartCount(data.savedCount);
        acknowledged = true;
      } catch {
        feedback.textContent = "하트 변경을 확인하지 못했습니다. 다시 시도해 주세요.";
      } finally {
        pendingHeart = "";
        heartRevision++;
        briefingSignature = "";
        for (const control of controls) control.removeAttribute("aria-disabled");
        button.removeAttribute("aria-busy");
      }
      if (library.open && (acknowledged || !byId("saved-hearts").childElementCount)) loadLibrary();
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest(".heart-toggle");
      if (button) toggleHeart(button);
    });

    const reader = byId("passage-reader");
    byId("brief-quotes").addEventListener("click", (event) => {
      const passage = event.target.closest(".brief-passage");
      if (!passage) return;
      byId("passage-text").textContent = passage.textContent;
      reader.showModal();
    });
    byId("close-passage").addEventListener("click", () => reader.close());

    function briefingRow(item) {
      const row = element("li", "brief-item heart-row");
      const copy = element("div", "brief-item-copy");
      row.dataset.itemId = item.id;
      if (item.kind === "topic") {
        const link = briefingLink(item.title, item.url, "brief-topic-link");
        if (!link || !item.title) return null;
        link.title = item.title;
        copy.append(link, topicMeta(item));
      } else {
        const passage = element("button", "brief-passage", item.text);
        passage.type = "button";
        passage.title = "글 펼쳐 읽기";
        passage.setAttribute("aria-haspopup", "dialog");
        copy.append(passage);
      }
      row.append(copy, heartButton(item));
      return row;
    }

    function renderBriefList(list, items) {
      const offset = list.scrollTop;
      const top = list.getBoundingClientRect().top + list.clientTop;
      const anchor = offset > 0 && Array.from(list.children).find(
        (row) => row.getBoundingClientRect().bottom > top);
      const anchorTop = anchor && anchor.getBoundingClientRect().top;
      const focused = document.activeElement;
      const focusedId = list.contains(focused) && focused.closest("li")?.dataset.itemId;
      const rows = new Map();
      for (const item of items) {
        if (!item?.id || rows.has(item.id)) continue;
        const row = briefingRow(item);
        if (row) rows.set(item.id, row);
      }
      list.replaceChildren(...rows.values());
      const newAnchor = anchor && rows.get(anchor.dataset.itemId);
      list.scrollTop = newAnchor
        ? list.scrollTop + newAnchor.getBoundingClientRect().top - anchorTop
        : offset;
      if (focusedId) {
        const selector = focused.matches(".heart-toggle") ? ".heart-toggle" : "a, .brief-passage";
        (rows.get(focusedId)?.querySelector(selector) || list).focus({preventScroll: true});
      }
      return rows.size;
    }

    function renderBriefing(data) {
      const signature = JSON.stringify(data);
      if (signature === briefingSignature) return;
      const quoteCount = renderBriefList(byId("brief-quotes"), data.quotes ?? [data.quote]);
      const topicCount = renderBriefList(byId("brief-topics"), data.topics);
      byId("brief-quotes-count").textContent = quoteCount + "편";
      byId("brief-topics-count").textContent = topicCount + "개";
      const quoteStatus = byId("brief-quotes-state");
      quoteStatus.textContent = quoteCount ? "" : "현재 표시할 글이 없습니다.";
      quoteStatus.hidden = quoteCount > 0;
      updateHeartCount(data.savedCount);
      const message = {
        loading: "소식을 불러오는 중…",
        cached: "저장된 소식",
        unavailable: "현재 소식을 불러올 수 없습니다.",
        empty: "최근 30일 동안 확인된 소식이 없습니다.",
      }[data.status] || (topicCount ? "" : "최근 소식이 없습니다.");
      const status = byId("brief-news-state");
      status.textContent = message;
      status.hidden = !message;
      briefingSignature = signature;
    }

    async function refreshBriefing() {
      let delay = 60000;
      const revision = heartRevision;
      try {
        const response = await fetch("/api/briefing", {cache: "no-store", signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error("briefing");
        const data = await response.json();
        if (!pendingHeart && revision === heartRevision) renderBriefing(data);
        if (data.status === "loading") delay = 3000;
        else if (data.status === "live" || data.status === "empty") delay = 300000;
      } catch {
        briefingSignature = "";
        if (!byId("brief-quotes").childElementCount) {
          byId("brief-quotes-state").textContent = "잠시 후 다시 불러옵니다.";
          byId("brief-quotes-state").hidden = false;
        }
        const status = byId("brief-news-state");
        status.textContent = byId("brief-topics").childElementCount ? "마지막으로 받은 소식" : "현재 소식을 불러올 수 없습니다.";
        status.hidden = false;
      } finally {
        window.setTimeout(refreshBriefing, delay);
      }
    }
    refreshBriefing();
  }

  function feedback(message, error = false) {
    const target = byId("feedback");
    target.dataset.state = error ? "error" : "ok";
    target.textContent = message;
  }

  function titleOf(request) {
    return request.split(/\r?\n|(?<=[.!?。])\s/u, 1)[0] || request;
  }

  function timestamp(entry) {
    const date = new Date(entry.at * 1000);
    const time = element("time", "chat-time", timeFormat.format(date));
    time.dateTime = date.toISOString();
    time.title = dateFormat.format(date) + " " + time.textContent;
    return time;
  }

  function syncComposer() {
    mode.querySelector('option[value="note"]').disabled = scope === "all";
    if (scope === "all") mode.value = "new";
    const next = mode.value === "note" ? "note-" + scope : "new";
    if (next !== draftKey) {
      drafts.set(draftKey, input.value);
      draftKey = next;
      input.value = drafts.get(draftKey) || "";
    }
    input.placeholder = mode.value === "note" ? "#" + scope + " 업무에 추가 지시를 입력하세요" : "어떤 업무를 맡길까요?";
    byId("send").disabled = sending || !online || !input.value.trim();
  }

  function setConnection(connected) {
    online = connected;
    const status = byId("connection");
    status.dataset.state = connected ? "online" : "offline";
    status.textContent = connected ? "실시간 연결" : "재연결 중";
    syncComposer();
    if (!connected) {
      for (const panel of document.querySelectorAll(".role[data-role]")) {
        panel.dataset.state = "offline";
        panel.querySelector(".role-status").textContent = "연결 확인 중";
        panel.querySelector(".role-task").textContent = "재연결 후 갱신";
      }
      renderFocus();
    }
  }

  function renderRoles(snapshot) {
    for (const panel of document.querySelectorAll(".role[data-role]")) {
      const stage = panel.dataset.role;
      const owned = cards.filter((card) => card.stage === stage);
      const work = ["running", "ready", "blocked", "unconfirmed"].map((state) =>
        owned.find((card) => card.state === state)).find(Boolean);
      const observation = stage === "auditor" && snapshot.roles?.auditor?.observation;
      const state = work?.state || (observation ? "observing" : "idle");
      panel.dataset.state = state;
      panel.querySelector(".role-status").textContent = {
        idle: "대기", running: "작업 중", ready: "인계 대기", blocked: "확인 필요", observing:"감시 중", unconfirmed:states.unconfirmed,
      }[state];
      const running = owned.filter((card) => card.state === "running");
      const runningLabel = (card) => {
        const entry = latestByCard.get(card.id);
        const activity = entry?.role === stage && entry.kind === "progress" && entry.seq >= card.claim
          ? entry.body : (running.length === 1 ? snapshot.roles?.[stage]?.activity : "");
        return "#" + card.id + " · " + (activity || titleOf(card.request));
      };
      const statusText = running.length ? running.map(runningLabel).join(" / ")
        : work ? "#" + work.id + " · " + titleOf(work.request)
        : observation ? "제임스 #" + observation.card + " · 최근 관찰 " + timeFormat.format(new Date(observation.observedAt*1000))
        : "배정된 업무 없음";
      if (running.length > 1) panel.querySelector(".role-status").textContent = running.length + "건 작업 중";
      const subtitle = panel.querySelector(".role-task");
      subtitle.textContent = statusText;
      subtitle.title = statusText;
    }
    byId("metric-total").textContent = cards.length;
    for (const key of ["running", "blocked", "done"]) {
      byId("metric-" + key).textContent = cards.filter((c) => c.state === key).length;
    }
  }

  function matchesFilter(card) {
    if (filter === "all") return true;
    if (filter === "active") return card.state === "ready" || card.state === "running";
    return card.state === filter;
  }

  function renderTasks() {
    const visible = cards.filter(matchesFilter);
    byId("task-count").textContent = String(visible.length);
    for (const button of document.querySelectorAll("#task-filters [data-filter]")) {
      const selected = button.dataset.filter === filter;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    const fragment = document.createDocumentFragment();
    if (!visible.length) {
      fragment.append(element("p", "empty-state", cards.length ? "이 상태의 업무가 없습니다." : "첫 업무를 채팅창에서 등록하세요."));
    }
    for (const card of visible) {
      const row = element("article", "task-row");
      row.dataset.state = card.state;
      row.classList.toggle("selected", String(card.id) === scope);
      const open = element("button", "task-open");
      open.type = "button";
      open.title = card.request;
      open.setAttribute("aria-label", "#" + card.id + " 업무 대화 보기: " + card.request);
      open.setAttribute("aria-pressed", String(String(card.id) === scope));
      open.addEventListener("click", () => chooseScope(String(card.id), true));
      const main = element("span", "task-main");
      const latest = latestByCard.get(card.id);
      const when = latest ? " · " + timeFormat.format(new Date(latest.at * 1000)) : "";
      main.append(element("span", "task-title", titleOf(card.request)),
        element("span", "task-sub", (roles[card.stage] || card.stage) +
          (card.stage === "worker" && card.state === "done" ? " · 직접 마감" : "") + when));
      const badge = element("span", "state-badge", states[card.state] || card.state);
      badge.dataset.state = card.state;
      open.append(element("span", "task-id", "#" + String(card.id).padStart(2, "0")), main, badge);
      row.append(open);
      if (card.state === "blocked") {
        const retry = element("button", "retry-btn", "다시 실행");
        retry.type = "button";
        retry.disabled = retrying.has(card.id);
        retry.setAttribute("aria-label", "#" + card.id + " 업무 다시 실행");
        retry.addEventListener("click", () => retryTask(card.id));
        row.append(retry);
      }
      fragment.append(row);
    }
    byId("tasks").replaceChildren(fragment);
  }

  function updateScopes() {
    const signature = JSON.stringify(cards.map((card) => [card.id, card.request]));
    if (scopeSignature === signature) return;
    scopeSignature = signature;
    const options = [new Option("전체 업무", "all")];
    for (const card of cards) {
      const title = titleOf(card.request);
      options.push(new Option("#" + card.id + " " + title.slice(0, 26), String(card.id)));
    }
    scopeSelect.replaceChildren(...options);
    if (!options.some((option) => option.value === scope)) chooseScope("all");
    scopeSelect.value = scope;
  }

  function chooseScope(value, reveal = false) {
    scope = value;
    scopeSelect.value = value;
    renderFocus();
    mode.value = value === "all" ? "new" : "note";
    syncComposer();
    renderTasks();
    renderConversation();
    feedback("");
    saveComposer();
    if (reveal && window.matchMedia("(max-width: 760px)").matches) {
      byId("chat").scrollIntoView({block: "start"});
    }
  }

  function appendProgress(container, entry) {
    if (!group || group.role !== entry.role || group.card !== entry.card) {
      const details = element("details", "chat-mini");
      details.dataset.kind = "progress";
      details.dataset.role = entry.role;
      const summary = element("summary", "mini-summary");
      const label = element("span", "mini-label");
      const time = timestamp(entry);
      const list = element("ol", "mini-list");
      summary.append(label, time);
      details.append(summary, list);
      container.append(details);
      group = {role: entry.role, card: entry.card, label, time, list, count: 0};
    }
    group.count++;
    const activity = entry.body.trim() || "진행 상황";
    const brief = activity.length > 40 ? activity.slice(0, 40) + "…" : activity;
    group.label.textContent = "#" + entry.card + " · " + roles[entry.role] + " · " + brief
      + (group.count > 1 ? " (" + group.count + ")" : "");
    const time = timestamp(entry);
    group.time.replaceWith(time);
    group.time = time;
    const item = element("li");
    item.append(timestamp(entry), element("span", "mini-body", activity));
    group.list.append(item);
  }

  // Keep the original message on the entry. Only the preview omits routing and long identifiers.
  function previewText(line) {
    return line.replace(/^\s*(?:[-*•]\s+|#{1,4}\s+|\d+[.)]\s+)/, "")
      .replace(/\*\*|`/g, "")
      .replace(/(?:\s+(?:work|batch)-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})/gi, "")
      .replace(/^(?:\d{4}-\d{2}-\d{2}\s+)?\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*KST\s*(?:기준[,，]?\s*)?/, "")
      .replace(/\s*\(PID\s*\d+\)/gi, "").trim();
  }

  function briefReport(entry) {
    const text = entry.body.replace(/^#\d+\s*·\s*/, "");
    const route = text.match(/^(?:제임스|클레어|모건|실무자|검토자|감사총무|계약직)\s*→\s*(제임스|클레어|모건|실무자|검토자|감사총무|계약직)\s*\r?\n/);
    const to = legacyNames[route?.[1]] || route?.[1];
    const lines = text.slice(route?.[0].length || 0).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const first = previewText(lines[0] || "");
    if (!first) return {summary: "", to};
    const sentences = lines.flatMap(line => line.split(/(?<=[.!?。])\s+/)).map(previewText).filter(Boolean);
    const asking = entry.kind === "ask" || entry.kind === "협의 요청";
    const request = /(?:주세요|주십시오|주시기 바랍니다|바랍니다|확인 요청|확인 부탁)[.?]?$|[?？]$/;
    const generic = /^(?:감사\s*#\d+을?를?\s*마감합니다|(?:감사총무|제임스|클레어|모건|실무자|검토자)께)\.?$/;
    const authored = first.length <= 115 && !generic.test(first) && (!asking || request.test(first));
    const lead = authored ? first : (asking && sentences.find(line => request.test(line))) ||
      sentences.find(line => !generic.test(line)) || first;
    const next = !asking && sentences.find(line => line !== lead && !lead.includes(line) &&
      /^(?:(?:다음(?:\s*(?:조치|단계|작업))?|후속\s*조치)\s*[·:：]|(?:이어서|다음에는|이후에는)\s)|(?:하겠습니다|할 예정입니다|해야 합니다)[.!]?$/.test(line));
    const compact = line => line.length <= 135 ? line : line.slice(0, 132).replace(/\s+\S{1,16}$/, "").trimEnd() + "…";
    return {summary: compact(lead), next: next ? compact(next) : "", to};
  }

  function reportBubble(entry, meta) {
    if (entry.body.trim().length <= 100 && !/[\r\n]/.test(entry.body.trim())) {
      return element("div", "chat-bubble", entry.body);
    }
    const {summary, next, to} = briefReport(entry);
    if (to) meta.querySelector(".chat-name").textContent += " → " + to;
    if (!summary || (!to && summary === entry.body.trim() && !next)) {
      return element("div", "chat-bubble", entry.body);
    }
    const bubble = element("div", "chat-bubble report-bubble");
    bubble.append(element("div", "report-summary", summary));
    if (next) bubble.append(element("div", "report-next", next));
    const details = element("details", "report-original");
    details.append(element("summary", "", "보고 원문"), element("div", "report-full", entry.body));
    bubble.append(details);
    return bubble;
  }

  function visibleInConversation(entry) {
    return scope === "all" ? !entry.channelCopy : String(entry.card) === scope;
  }

  function appendMessage(container, entry) {
    const date = new Date(entry.at * 1000);
    const day = dayKeyFormat.format(date);
    if (day !== lastDay) {
      lastDay = day;
      group = null;
      const separator = element("div", "chat-day");
      const label = element("time", "", dateFormat.format(date));
      label.dateTime = day;
      label.title = day;
      separator.append(label);
      container.append(separator);
    }
    if (entry.kind === "progress") {
      appendProgress(container, entry);
      return;
    }
    group = null;
    const row = element("article", "chat-event");
    row.id = "chat-entry-" + entry.seq;
    row.tabIndex = -1;
    row.dataset.role = entry.role;
    row.dataset.kind = entry.kind;
    const avatar = element("span", "chat-avatar", avatars[entry.role] || "·");
    avatar.setAttribute("aria-hidden", "true");
    const content = element("div", "chat-content");
    const meta = element("div", "chat-meta");
    const tag = element("button", "chat-card", "#" + entry.card);
    tag.type = "button";
    tag.setAttribute("aria-label", "#" + entry.card + " 업무 대화 보기");
    tag.addEventListener("click", () => chooseScope(String(entry.card)));
    const sender = roles[entry.role] || entry.role;
    const escalation = entry.kind === "escalate" && (entry.role === "worker" ? roles.reviewer : entry.role === "reviewer" ? roles.auditor : "");
    meta.append(element("strong", "chat-name", escalation ? sender+" → "+escalation : sender),
      element("span", "chat-kind", entry.kind==="escalate" && entry.role==="reviewer" ? "핵심 사안 이관" : kinds[entry.kind] || entry.kind), tag, timestamp(entry));
    content.append(meta);
    if (entry.kind === "files") {
      const files = element("div", "chat-files");
      for (const path of entry.body.split(/\r?\n/).slice(1).filter(Boolean)) {
        const link = element("a", "file-link", path);
        link.href = "/api/tasks/" + entry.card + "/file?" + new URLSearchParams({path: path.replaceAll("\\", "/")});
        link.download = path.split(/[\\/]/).pop();
        files.append(link);
      }
      content.append(files);
    } else if (entry.body) {
      content.append(entry.role === "user" ? element("div", "chat-bubble", entry.body) : reportBubble(entry, meta));
    }
    row.append(avatar, content);
    container.append(row);
  }

  function atBottom() {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  }

  function resetUnread() {
    unread = 0;
    jump.hidden = true;
  }

  function latest() {
    feed.scrollTop = feed.scrollHeight;
    resetUnread();
  }

  function refreshOwnButton() {
    const confirmed = ownByScope.get(scope);
    const pending = [...outbox.values()].reverse().find(message => scope === "all" || String(message.card) === scope);
    latestOwn = pending && (!confirmed || pending.at >= confirmed.at) ? pending : confirmed;
    latestOwnButton.hidden = !latestOwn;
    if (latestOwn) {
      latestOwnButton.querySelector("span").textContent = latestOwn.body;
      latestOwnButton.title = latestOwn.body;
    }
  }

  function renderOutbox() {
    for (const old of feed.querySelectorAll("[data-pending]")) old.remove();
    for (const message of outbox.values()) {
      if (scope !== "all" && String(message.card) !== scope) continue;
      feed.querySelector(".empty-state")?.remove();
      const row = element("article", "chat-event");
      row.id = "chat-pending-" + message.id;
      row.dataset.pending = message.id;
      row.dataset.role = "user";
      row.tabIndex = -1;
      const content = element("div", "chat-content");
      const meta = element("div", "chat-meta");
      meta.append(element("strong", "chat-name", "나"),
        element("span", "chat-kind", {sending:"전송 중", accepted:"접수됨", uncertain:"전송 확인 필요"}[message.status]),
        timestamp(message));
      if (message.status === "uncertain") {
        const retry = element("button", "", "다시 보내기");
        retry.type = "button";
        retry.addEventListener("click", () => deliverMessage(message));
        meta.append(retry);
      }
      content.append(meta, element("div", "chat-bubble", message.body));
      row.append(content);
      feed.append(row);
    }
    refreshOwnButton();
  }

  latestOwnButton.addEventListener("click", () => {
    if (!latestOwn) return;
    const message = latestOwn;
    if (message.card && cards.some(card => card.id === message.card) && String(message.card) !== scope) {
      chooseScope(String(message.card));
    }
    const row = byId(message.seq ? "chat-entry-" + message.seq : "chat-pending-" + message.id);
    row?.focus({preventScroll:true});
    row?.scrollIntoView({block:"center", inline:"nearest"});
  });

  function renderConversation() {
    const fragment = document.createDocumentFragment();
    group = null;
    lastDay = "";
    let count = 0;
    for (const entry of timeline) {
      if (visibleInConversation(entry)) {
        appendMessage(fragment, entry);
        count++;
      }
    }
    if (!count) fragment.append(element("p", "empty-state", "아직 대화가 없습니다."));
    feed.replaceChildren(fragment);
    renderOutbox();
    latest();
  }

  function appendEntries(incoming) {
    const fragment = document.createDocumentFragment();
    const pinned = atBottom();
    let count = 0;
    let reconciled = false;
    for (const entry of incoming) {
      if (entry.seq <= cursor) continue;
      cursor = entry.seq;
      timeline.push(entry);
      if (entry.userSubmitted && entry.role === "user" && ["request", "note"].includes(entry.kind)) {
        ownByScope.set("all", entry);
        ownByScope.set(String(entry.card), entry);
      }
      if (entry.requestId && outbox.delete(entry.requestId)) reconciled = true;
      latestByCard.set(entry.card, entry);
      if (entry.kind === "contract_start") contractedCards.add(entry.card);
      if (["contract_result", "contract_interrupt", "contract_accept", "contract_reject", "interrupt", "error", "close"].includes(entry.kind)) {
        contractedCards.delete(entry.card);
      }
      if (visibleInConversation(entry)) {
        appendMessage(fragment, entry);
        count++;
      }
    }
    if (reconciled) saveComposer();
    if (!count) {
      if (reconciled) renderOutbox();
      return;
    }
    feed.querySelector(".empty-state")?.remove();
    feed.append(fragment);
    renderOutbox();
    if (pinned) latest();
    else {
      unread += count;
      jump.textContent = "새 소식 " + unread + "건";
      jump.hidden = false;
    }
  }

  async function synchronize() {
    const response = await fetch("/api/board?after=" + cursor, {cache: "no-store", signal: AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error("칠판 연결 실패");
    const snapshot = await response.json();
    const first = cardSignature === undefined;
    const wasOnline = online;
    const previousCursor = cursor;
    cards = snapshot.cards.map(card => card.state==="running" && ["reviewer","auditor"].includes(card.stage)
      && !snapshot.roles?.[card.stage]?.activity ? {...card, state:"unconfirmed"} : card);
    const previousSources = new Map(externalActivities.map((item) => [item.id, item]));
    externalActivities = (snapshot.externalActivities || [])
      .filter((item) => item.id && typeof item.title === "string" && Object.hasOwn(states, item.state))
      .map((item) => ({...item, stage:"sourcing"}));
    appendEntries(snapshot.entries);
    updateScopes();
    const signature = JSON.stringify(cards.map((c) => [c.id, c.stage, c.state, c.request,
      Math.floor((latestByCard.get(c.id)?.at || 0) / 60)]));
    if (signature !== cardSignature) {
      cardSignature = signature;
      renderTasks();
    }
    if (first && !timeline.length) renderConversation();
    if (first) latest();
    renderRoles(snapshot);
    setConnection(true);
    const recent = (at) => snapshot.now - at < 5 && snapshot.now >= at;
    const sourceEvent = externalActivities.some((item) =>
      recent(item.updatedAt) && item.updatedAt !== previousSources.get(item.id)?.updatedAt);
    const cardEvent = snapshot.entries.some((entry) =>
      entry.seq > previousCursor && !entry.channelCopy
      && recent(entry.at));
    renderFocus(!first && wasOnline && !document.hidden && (sourceEvent || cardEvent));
  }

  function sync() {
    if (!syncInFlight) {
      syncInFlight = synchronize().catch(() => setConnection(false)).finally(() => { syncInFlight = undefined; });
    }
    return syncInFlight;
  }

  async function poll() {
    await sync();
    window.setTimeout(poll, document.hidden ? 4000 : 900);
  }

  async function post(url, text, requestId) {
    const key = JSON.stringify([url, text]);
    if (!requestId && !pendingRequests.has(key)) pendingRequests.set(key, crypto.randomUUID());
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json", "X-Team-Board": "1"},
      body: JSON.stringify({text, client: "dashboard", requestId: requestId || pendingRequests.get(key)}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || "처리하지 못했습니다.");
    pendingRequests.delete(key);
    return result;
  }

  async function retryTask(id) {
    if (retrying.has(id)) return;
    retrying.add(id);
    renderTasks();
    try {
      await post("/api/tasks/" + id + "/retry");
      await sync();
      feedback("#" + id + " 업무를 다시 실행합니다.");
    } catch (error) {
      feedback("재시도 실패 · " + error.message, true);
    } finally {
      retrying.delete(id);
      renderTasks();
    }
  }

  async function deliverMessage(message) {
    if (sending || !outbox.has(message.id)) return;
    sending = true;
    message.status = "sending";
    saveComposer();
    renderOutbox();
    syncComposer();
    feedback("전송 중…");
    try {
      const result = await post(message.url, message.body, message.id);
      message.status = "accepted";
      message.card = result.id || message.card;
      // A POST receipt can arrive before earlier timeline entries. Only the poll advances cursor.
      saveComposer();
      if (outbox.has(message.id)) renderOutbox();
      feedback("#" + message.card + (message.url === "/api/tasks" ? " 업무를 등록했습니다." : " 추가 지시를 남겼습니다."));
      await sync();
    } catch (error) {
      if (outbox.has(message.id)) {
        message.status = "uncertain";
        saveComposer();
        renderOutbox();
        feedback("전송 확인 필요 · " + error.message, true);
      } else {
        feedback("서버 대화 기록에서 접수를 확인했습니다.");
      }
    } finally {
      sending = false;
      syncComposer();
    }
  }

  byId("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const body = input.value.trim();
    if (sending || !online || !body) return;
    const isNote = mode.value === "note";
    const card = isNote ? Number(scope) : null;
    const message = {id:crypto.randomUUID(), at:Date.now() / 1000, card, body, status:"sending",
      url:isNote ? "/api/tasks/" + card + "/notes" : "/api/tasks"};
    outbox.set(message.id, message);
    input.value = "";
    drafts.delete(draftKey);
    if (!isNote && scope !== "all") chooseScope("all");
    saveComposer();
    renderOutbox();
    latest();
    deliverMessage(message);
  });

  byId("new-task").addEventListener("click", () => {
    if (scope !== "all") chooseScope("all");
    mode.value = "new";
    syncComposer();
    input.focus();
  });
  input.addEventListener("input", () => {
    if (input.value) drafts.set(draftKey, input.value); else drafts.delete(draftKey);
    saveComposer();
    syncComposer();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      byId("composer").requestSubmit();
    }
  });
  mode.addEventListener("change", () => { syncComposer(); saveComposer(); input.focus(); });
  scopeSelect.addEventListener("change", () => chooseScope(scopeSelect.value));
  for (const button of document.querySelectorAll("#task-filters [data-filter]")) {
    button.addEventListener("click", () => { filter = button.dataset.filter; renderTasks(); });
  }
  feed.addEventListener("scroll", () => { if (atBottom()) resetUnread(); }, {passive: true});
  jump.addEventListener("click", latest);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
  syncComposer();
  renderOutbox();
  renderClock();
  window.setInterval(renderClock, 1000);
  if (document.body.dataset.briefing === "on") mountBriefing();
  poll();
})();
