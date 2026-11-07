// Background service worker. Private handlers (internal endpoints) live in the
// git-ignored background.local.js; without it this does nothing.
try { importScripts("background.local.js"); } catch { /* no private handlers installed */ }

// TEMP diagnostics for peek framing (unpacked extensions only): log every rule match.
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(i =>
  console.log("[peek] rule", i.rule.ruleId, "matched", i.request.type, i.request.url, "tab", i.request.tabId, "initiator", i.request.initiator));
