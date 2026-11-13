// claude.ai/new?q=… only fills in the prompt. When ArcTab opened the page (a shortcut
// search), the URL carries a one-time arctab_send token; if background.js vouches for it,
// press Send. A link from anywhere else can't carry a token that checks out.
(() => {
  // Not checking for q: claude.ai takes it out of the URL as soon as it reads it.
  const token = new URLSearchParams(location.search).get("arctab_send");
  if (!token) return;
  const log = (...a) => console.log("[arctab] claude send:", ...a);
  log("token found");
  chrome.runtime.sendMessage({ type: "arctab:claude-send", token }).then(ok => {
    log(ok ? "token accepted" : "token rejected");
    if (!ok) return;
    // Send stays disabled until the prompt is filled in.
    const send = () => {
      const btn = document.querySelector('button[aria-label^="Send" i]');
      if (!btn || btn.disabled) return false;
      btn.click();
      log("pressed", btn.getAttribute("aria-label"));
      return true;
    };
    if (send()) return;
    const obs = new MutationObserver(() => { if (send()) stop(); });
    const timer = setTimeout(() => {
      stop();
      log("no enabled Send button after 20s; buttons:", [...document.querySelectorAll("button[aria-label]")].map(b => `${b.getAttribute("aria-label")}${b.disabled ? " (disabled)" : ""}`));
    }, 20_000);
    const stop = () => { obs.disconnect(); clearTimeout(timer); };
    obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
  }, e => log("message failed", e.message));
})();
