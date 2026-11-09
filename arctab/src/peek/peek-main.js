// Page-world half of peek-keys.js (registered with world: "MAIN"): single-page apps add
// history entries with history.pushState, which would land in the homepage tab's
// back/forward list. Inside a peek, turn those into replaceState and tell the peek about
// the new URL so its own arrows can step back to it.
(() => {
  if (window.top === window || window.parent !== window.top) return;
  const parentOrigin = location.ancestorOrigins?.[0] || "";
  if (!parentOrigin.startsWith("chrome-extension://")) return;
  const tell = kind => window.parent.postMessage({ arctabPeek: kind, url: location.href, title: document.title }, parentOrigin);
  const { replaceState } = History.prototype;
  History.prototype.pushState = function (state, title, url) {
    replaceState.call(this, state, title, url);
    tell("page");
  };
  History.prototype.replaceState = function (state, title, url) {
    replaceState.call(this, state, title, url);
    tell("replace");
  };
})();
