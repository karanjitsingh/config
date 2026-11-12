// GM_* / GM.* for userscripts running in a peek (see userscripts.js). Runs in the script's
// own USER_SCRIPT world, right before it, after `__arctabUS` is set. Calls that need the
// extension (cross-site requests, saving values, opening tabs) go to background.js.
(() => {
  const S = globalThis.__arctabUS;
  if (!S?.run) return;
  const ask = (op, extra) => chrome.runtime.sendMessage({ id: S.id, op, ...extra });
  const values = { ...S.values };
  let saveTimer = 0;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => ask("setValues", { values }), 200); };

  const GM_info = S.info;
  const GM_getValue = (k, d) => (k in values ? values[k] : d);
  const GM_setValue = (k, v) => { values[k] = v; save(); };
  const GM_deleteValue = k => { delete values[k]; save(); };
  const GM_listValues = () => Object.keys(values);
  const GM_addStyle = css => {
    const st = document.createElement("style");
    st.textContent = css;
    (document.head || document.documentElement).append(st);
    return st;
  };
  const GM_addElement = (parent, tag, attrs) => {
    if (typeof parent === "string") [parent, tag, attrs] = [document.head || document.documentElement, parent, tag];
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === "textContent") n.textContent = v; else n.setAttribute(k, v); }
    parent.append(n);
    return n;
  };
  const GM_getResourceText = name => S.resources?.[name]?.text ?? null;
  const GM_getResourceURL = name => {
    const r = S.resources?.[name];
    return r ? `data:text/plain;base64,${btoa(unescape(encodeURIComponent(r.text)))}` : null;
  };
  const GM_openInTab = (url, opts) => { ask("openInTab", { url, background: typeof opts === "boolean" ? opts : !!(opts?.active === false || opts?.loadInBackground) }); return { close() {} }; };
  const GM_setClipboard = text => navigator.clipboard.writeText(String(text)).catch(() => {});
  const GM_notification = d => console.info("[userscript]", typeof d === "string" ? d : d?.text);
  const GM_registerMenuCommand = () => 0; // no menu to put it in
  const GM_unregisterMenuCommand = () => {};
  const GM_log = (...a) => console.log(...a);

  function GM_xmlhttpRequest(d) {
    let aborted = false;
    const req = { method: d.method, url: d.url, headers: d.headers, data: d.data, responseType: d.responseType, timeout: d.timeout, anonymous: d.anonymous };
    ask("xhr", { req }).then(r => {
      if (aborted) return;
      if (!r || r.error) {
        const resp = { status: 0, statusText: r?.error || "error", readyState: 4, error: r?.error, context: d.context };
        (r?.error === "timeout" ? d.ontimeout : d.onerror)?.(resp);
        d.onloadend?.(resp);
        return;
      }
      let response = r.text;
      if (d.responseType === "json") { try { response = JSON.parse(r.text); } catch { response = null; } }
      else if (d.responseType === "arraybuffer" || d.responseType === "blob") {
        const bin = atob(r.base64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        response = d.responseType === "blob" ? new Blob([bytes], { type: r.contentType }) : bytes.buffer;
      }
      const resp = { status: r.status, statusText: r.statusText, finalUrl: r.finalUrl, responseHeaders: r.responseHeaders, responseText: r.text, response, readyState: 4, context: d.context };
      d.onreadystatechange?.(resp);
      d.onload?.(resp);
      d.onloadend?.(resp);
    });
    return { abort() { aborted = true; d.onabort?.({}); } };
  }

  const GM = {
    info: GM_info,
    getValue: async (k, d) => GM_getValue(k, d),
    setValue: async (k, v) => GM_setValue(k, v),
    deleteValue: async k => GM_deleteValue(k),
    listValues: async () => GM_listValues(),
    addStyle: async css => GM_addStyle(css),
    addElement: async (...a) => GM_addElement(...a),
    getResourceText: async n => GM_getResourceText(n),
    getResourceUrl: async n => GM_getResourceURL(n),
    openInTab: async (u, o) => GM_openInTab(u, o),
    setClipboard: async t => GM_setClipboard(t),
    notification: async d => GM_notification(d),
    registerMenuCommand: async () => 0,
    xmlHttpRequest: d => new Promise((resolve, reject) => GM_xmlhttpRequest({ ...d, onload: r => { d.onload?.(r); resolve(r); }, onerror: r => { d.onerror?.(r); reject(r); }, ontimeout: r => { d.ontimeout?.(r); reject(r); } })),
  };

  Object.assign(globalThis, {
    GM, GM_info, GM_getValue, GM_setValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_addElement,
    GM_getResourceText, GM_getResourceURL, GM_openInTab, GM_setClipboard, GM_notification,
    GM_registerMenuCommand, GM_unregisterMenuCommand, GM_log, GM_xmlhttpRequest,
    unsafeWindow: window, // the script's own window: user scripts don't share the page's globals
  });
})();
