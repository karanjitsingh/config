// Refresh every widget that publishes updates if its data is stale, publish, then tell
// background.js we're done so it can close this document.
(async () => {
  for (const def of WIDGETS.values()) {
    if (!def.updates) continue;
    try {
      const cached = widgetCache.get(def.id);
      if (cached && Date.now() - cached.at < (def.refreshMs ?? 60_000)) { await publishUpdates(def, cached); continue; }
      if (def.origins?.length && !(await chrome.permissions.contains({ origins: def.origins }))) continue;
      const fresh = { at: Date.now(), data: await def.fetch() };
      widgetCache.set(def.id, fresh);
      await publishUpdates(def, fresh);
    } catch (e) { console.warn("[arctab] updates refresh:", def.id, e); } // signed out etc.: keep what's there
  }
  chrome.runtime.sendMessage({ type: "arctab:updates-done" }).catch(() => {});
})();
