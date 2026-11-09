// What the widget scripts expect from the homepage, minus the page itself.
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "dataset") Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...children);
  return n;
};
const saveSnapshot = () => {};

// Offscreen documents only get chrome.runtime. Widgets also use chrome.storage.local and
// chrome.permissions.contains, so those go through background.js (see "arctab:offscreen").
if (!chrome.storage) {
  chrome.storage = {
    // get() always resolves to an object (widgets destructure it), even if the worker
    // didn't answer.
    local: { get: async k => (await call("get", k ?? null)) || {}, set: o => call("set", o), remove: k => call("remove", k) },
    onChanged: { addListener() {} }, // one-shot page: nothing to react to
  };
}
if (!chrome.permissions) chrome.permissions = { contains: o => call("contains", o) };
function call(op, arg) {
  return chrome.runtime.sendMessage({ type: "arctab:offscreen", op, arg }).catch(e => { console.warn("[arctab] offscreen", op, e.message); return null; });
}
