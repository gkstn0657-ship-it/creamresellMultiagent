(() => {
  if (window.__allTabsRecorderInstalled) return;
  window.__allTabsRecorderInstalled = true;

  let recording = false;
  let lastScrollAt = 0;

  const describe = (node) => {
    const element = node instanceof Element
      ? node.closest("a, button, input, select, textarea, [role=button], [contenteditable=true]") || node
      : null;
    if (!element) return {};
    const link = element.closest("a");
    let linkPath = null;
    try {
      linkPath = link?.href ? new URL(link.href).pathname : null;
    } catch {
      linkPath = null;
    }
    return {
      tag: element.tagName,
      role: element.getAttribute("role"),
      inputType: element.getAttribute("type"),
      isLink: Boolean(link),
      linkPath
    };
  };

  const page = () => {
    try {
      const url = new URL(location.href);
      return { url: `${url.origin}${url.pathname}` };
    } catch {
      return { url: null };
    }
  };

  const emit = (eventType, data = {}) => {
    if (!recording) return;
    chrome.runtime.sendMessage({ type: "PAGE_EVENT", eventType, data: { source: "user", ...page(), ...data } }).catch(() => {});
  };

  addEventListener("click", (event) => {
    if (event.isTrusted) emit("click", { target: describe(event.target) });
  }, true);
  addEventListener("change", (event) => {
    if (event.isTrusted) emit("change", { target: describe(event.target) });
  }, true);
  addEventListener("input", (event) => {
    if (!event.isTrusted) return;
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
    emit("input", { target: describe(element), valueCaptured: false });
  }, true);
  addEventListener("scroll", (event) => {
    if (!event.isTrusted || Date.now() - lastScrollAt < 750) return;
    lastScrollAt = Date.now();
    const element = event.target instanceof Element ? event.target : null;
    emit("scroll", {
      target: element ? describe(element) : { tag: "DOCUMENT" },
      x: element ? element.scrollLeft : scrollX,
      y: element ? element.scrollTop : scrollY
    });
  }, true);
  addEventListener("popstate", () => emit("history_popstate"));
  addEventListener("beforeunload", () => emit("page_leaving"));

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "RECORDER_START") {
      recording = true;
      emit("page_recording_started", { source: "extension" });
    }
    if (message.type === "RECORDER_STOP") {
      emit("page_recording_stopped", { source: "extension" });
      recording = false;
    }
  });

  chrome.runtime.sendMessage({ type: "GET_STATE" }).then(({ state }) => {
    if (state?.isRecording) {
      recording = true;
      emit("page_recording_started", { source: "extension" });
    }
  }).catch(() => {});
})();
