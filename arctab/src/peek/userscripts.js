// Userscripts in peeks (loaded by background.js).
//
// Chrome won't let one extension script frames inside another extension's page, so
// Tampermonkey (or any other extension) never runs in a peek. ArcTab runs your userscripts
// there itself: add a .user.js in Settings → Peek (a file, or a URL it re-reads), and it's
// registered with chrome.userScripts, guarded to run only in frames under an ArcTab page.
// Normal tabs are left to Tampermonkey, so nothing runs twice.
//
// Needs "Allow User Scripts" on for ArcTab (chrome://extensions → ArcTab → Details).
//
// Supported: @match / @include / @exclude / @exclude-match, @run-at, @require,
// @resource, @connect, and the common GM_* / GM.* calls (src/peek/gm.js). @noframes means
// "only the peeked page itself", not its subframes. unsafeWindow is the script's own
// window: user scripts run in an isolated world, not the page's.
const US_KEY = "peekUserScripts";     // [{ id, name, url?, enabled, source, requires: [code], resources: {name: {text, url}}, meta }]
const US_VALUES = id => `usValues:${id}`; // GM_setValue storage, per script
const US_REFRESH_MS = 10 * 60_000;

function usAvailable() {
  try { chrome.userScripts.getScripts(); return true; } catch { return false; }
}

// "// @key value" lines between ==UserScript== markers.
function usParse(source) {
  const block = /\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/.exec(source)?.[1] || "";
  const meta = {};
  for (const line of block.split("\n")) {
    const m = /^\s*\/\/\s*@([\w:.-]+)(?:\s+(.*?))?\s*$/.exec(line);
    if (m) (meta[m[1]] ||= []).push(m[2] ?? "");
  }
  return meta;
}

// Fetch a script (and its @require / @resource files) into the stored form.
async function usBuild(source, { url, id, enabled = true } = {}) {
  const meta = usParse(source);
  const name = meta.name?.[0] || "Untitled script";
  const abs = u => new URL(u, url || undefined).href;
  const get = async u => { const r = await fetch(abs(u), { cache: "no-store" }); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.text(); };
  const requires = [];
  for (const u of meta.require || []) requires.push(await get(u));
  const resources = {};
  for (const line of meta.resource || []) {
    const [rname, u] = line.split(/\s+/);
    if (rname && u) resources[rname] = { url: abs(u), text: await get(u) };
  }
  return { id: id || `us-${crypto.randomUUID().slice(0, 8)}`, name, url, enabled, source, requires, resources, meta, at: Date.now() };
}

// A valid match pattern for chrome.userScripts, or null (then it's treated as a glob).
const usIsPattern = p => p === "<all_urls>" || /^(\*|https?|file|ftp|wss?):\/\/(\*|\*\.[^/*]+|[^/*]+)?\/.*$/.test(p);

function usRegistrations(s, values) {
  const m = s.meta;
  const noframes = "noframes" in m;
  const runAt = { "document-start": "document_start", "document-end": "document_end", "document-body": "document_end" }[m["run-at"]?.[0]] || "document_idle";
  const info = {
    id: s.id, noframes, values, resources: s.resources,
    connect: m.connect || [],
    info: { script: { name: s.name, namespace: m.namespace?.[0] || "", version: m.version?.[0] || "", description: m.description?.[0] || "", matches: m.match || [], includes: m.include || [] }, scriptHandler: "ArcTab", version: chrome.runtime.getManifest().version },
  };
  // Only in a peek: a frame whose top is an ArcTab page (with @noframes, only its direct child).
  const home = `chrome-extension://${chrome.runtime.id}`;
  const guard = `(() => { const a = location.ancestorOrigins; if (!a?.length) return false; return ${noframes} ? a.length === 1 && a[0] === ${JSON.stringify(home)} : a[a.length - 1] === ${JSON.stringify(home)}; })()`;
  const js = [
    { code: `var __arctabUS = ${JSON.stringify(info)}; __arctabUS.run = ${guard};` },
    { file: "src/peek/gm.js" },
    ...s.requires.map(code => ({ code: `if (__arctabUS.run) {\n${code}\n}` })),
    { code: `if (__arctabUS.run) (function () {\n${s.source}\n}).call(window);` },
  ];
  const base = { js, allFrames: true, runAt, world: "USER_SCRIPT", worldId: s.id };
  const matches = (m.match || []).filter(usIsPattern);
  const includes = [...(m.include || []), ...(m.match || []).filter(p => !usIsPattern(p))];
  const excludeMatches = (m["exclude-match"] || []).filter(usIsPattern);
  const excludeGlobs = m.exclude || [];
  const regs = [];
  if (matches.length) regs.push({ ...base, id: s.id, matches, excludeMatches, excludeGlobs });
  // @include globs ("*" means anything): any URL, narrowed by the globs.
  if (includes.length) regs.push({ ...base, id: `${s.id}~inc`, matches: ["<all_urls>"], includeGlobs: includes.map(g => (g === "*" ? "*://*/*" : g)), excludeMatches, excludeGlobs });
  if (!regs.length) regs.push({ ...base, id: s.id, matches: ["<all_urls>"], excludeMatches, excludeGlobs });
  return regs;
}

// Make what's registered match what's stored.
let usChain = Promise.resolve();
function usSync() {
  usChain = usChain.then(async () => {
    if (!usAvailable()) return;
    await chrome.userScripts.configureWorld({ messaging: true });
    const { [US_KEY]: list = [] } = await chrome.storage.local.get(US_KEY);
    const on = list.filter(s => s.enabled);
    const vals = await chrome.storage.local.get(on.map(s => US_VALUES(s.id)));
    // Each script gets its own world (its GM_* state stays its own); each one needs
    // messaging switched on to reach background.js.
    for (const s of on) await chrome.userScripts.configureWorld({ worldId: s.id, messaging: true });
    const want = on.flatMap(s => usRegistrations(s, vals[US_VALUES(s.id)] || {}));
    const have = (await chrome.userScripts.getScripts()).map(s => s.id);
    if (have.length) await chrome.userScripts.unregister({ ids: have });
    if (want.length) await chrome.userScripts.register(want);
  }).catch(e => console.warn("[arctab] userscripts:", e.message));
  return usChain;
}

// Scripts added by URL are re-read now and then (and on Settings' ↻), so edits show up.
async function usRefreshSources(force = false) {
  const { [US_KEY]: list = [] } = await chrome.storage.local.get(US_KEY);
  let changed = false;
  for (const [i, s] of list.entries()) {
    if (!s.url || (!force && Date.now() - (s.at || 0) < US_REFRESH_MS)) continue;
    try {
      const res = await fetch(s.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const source = await res.text();
      list[i] = source === s.source ? { ...s, at: Date.now(), error: undefined } : await usBuild(source, s);
    } catch (e) { list[i] = { ...s, at: Date.now(), error: e.message }; }
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ [US_KEY]: list });
}

chrome.storage.onChanged.addListener((c, area) => {
  if (area === "local" && US_KEY in c) usSync();
});
chrome.runtime.onInstalled.addListener(() => usSync());
chrome.runtime.onStartup.addListener(() => usRefreshSources().then(usSync));
usSync();

// Settings asks for these (it can't fetch file:// itself, and builds go through here).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !String(msg?.type).startsWith("us:")) return;
  (async () => {
    const { [US_KEY]: list = [] } = await chrome.storage.local.get(US_KEY);
    if (msg.type === "us:status") return { available: usAvailable() };
    if (msg.type === "us:sync") { await usSync(); return { ok: true }; }
    if (msg.type === "us:add") {
      let source = msg.source;
      if (!source) {
        const res = await fetch(msg.url, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        source = await res.text();
      }
      if (!/==UserScript==/.test(source)) throw new Error("No ==UserScript== header");
      const s = await usBuild(source, { url: msg.url });
      // Same name (and source location) again: replace it.
      const at = list.findIndex(x => x.name === s.name && (x.url || "") === (s.url || ""));
      if (at >= 0) list[at] = { ...s, id: list[at].id, enabled: list[at].enabled };
      else list.push(s);
      await chrome.storage.local.set({ [US_KEY]: list });
      return { ok: true, name: s.name };
    }
    if (msg.type === "us:refresh") { await usRefreshSources(true); return { ok: true }; }
    throw new Error(`unknown ${msg.type}`);
  })().then(reply, e => reply({ error: e.message }));
  return true;
});

// ---------- GM_* calls from the scripts (src/peek/gm.js) ----------
const usValueWrites = new Map(); // id -> timer: re-register so the next page load sees new values
const hostOk = (host, list) => list.some(c => c === "*" || c === "self" || host === c || host.endsWith(`.${c}`));
chrome.runtime.onUserScriptMessage?.addListener((msg, sender, reply) => {
  (async () => {
    const { [US_KEY]: list = [] } = await chrome.storage.local.get(US_KEY);
    const s = list.find(x => x.id === msg?.id && x.enabled);
    if (!s) throw new Error("unknown script");
    if (msg.op === "xhr") {
      const r = msg.req;
      const url = new URL(r.url, sender.url);
      const pageHost = new URL(sender.url).hostname;
      if (url.hostname !== pageHost && !hostOk(url.hostname, s.meta.connect || [])) throw new Error(`${url.hostname} isn't in the script's @connect`);
      const ctl = new AbortController();
      const timer = r.timeout ? setTimeout(() => ctl.abort(), r.timeout) : 0;
      try {
        const res = await fetch(url, { method: r.method || "GET", headers: r.headers || {}, body: r.data ?? undefined, credentials: r.anonymous ? "omit" : "include", signal: ctl.signal });
        const binary = r.responseType === "arraybuffer" || r.responseType === "blob";
        let text = "", base64 = "";
        if (binary) { const b = new Uint8Array(await res.arrayBuffer()); let str = ""; for (let i = 0; i < b.length; i += 0x8000) str += String.fromCharCode(...b.subarray(i, i + 0x8000)); base64 = btoa(str); }
        else text = await res.text();
        return { status: res.status, statusText: res.statusText, finalUrl: res.url, responseHeaders: [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\r\n"), text, base64, contentType: res.headers.get("content-type") || "" };
      } catch (e) { return { error: e.name === "AbortError" ? "timeout" : e.message }; }
      finally { clearTimeout(timer); }
    }
    if (msg.op === "setValues") {
      await chrome.storage.local.set({ [US_VALUES(s.id)]: msg.values });
      clearTimeout(usValueWrites.get(s.id));
      usValueWrites.set(s.id, setTimeout(() => { usValueWrites.delete(s.id); usSync(); }, 1500));
      return { ok: true };
    }
    if (msg.op === "openInTab") {
      const url = new URL(msg.url, sender.url).href;
      if (!/^https?:/.test(url)) throw new Error("only web pages");
      await chrome.tabs.create({ url, active: !msg.background, index: sender.tab ? sender.tab.index + 1 : undefined, windowId: sender.tab?.windowId });
      return { ok: true };
    }
    throw new Error(`unknown op ${msg.op}`);
  })().then(reply, e => reply({ error: e.message }));
  return true;
});
