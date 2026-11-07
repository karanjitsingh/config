(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const list = document.getElementById("list");
  const status = document.getElementById("status");
  const titleInput = document.getElementById("title");

  if (!tab?.url || !/^https?:/.test(tab.url)) {
    status.textContent = "This page can't be pinned.";
    titleInput.remove();
    return;
  }
  titleInput.value = tab.title || hostOf(tab.url);

  const { bar, other, fav, archive } = await loadLayout();
  const [[otherTree], [barTree]] = await Promise.all([bm.getSubTree(other.id), bm.getSubTree(bar.id)]);

  // ✓ marks folders that already contain this URL.
  const has = f => (f.children || []).some(c => c.url === tab.url);

  const add = (f, depth, label, recurse = true) => {
    const name = label || f.title;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = (has(f) ? "✓ " : "") + name;
    b.style.paddingLeft = `${12 + depth * 16}px`;
    b.addEventListener("click", async () => {
      await bm.create({ parentId: f.id, title: titleInput.value.trim() || hostOf(tab.url), url: tab.url });
      status.textContent = `Added to ${name}`;
      setTimeout(() => window.close(), 600);
    });
    list.append(b);
    if (recurse) (f.children || []).filter(isFolder).forEach(c => add(c, depth + 1));
  };

  add(otherTree.children.find(c => c.id === fav.id), 0, "★ Favorites", false);
  add(otherTree, 0, "Pages", false);
  add(barTree, 0, "Bookmarks bar");
  otherTree.children
    .filter(c => isFolder(c) && c.id !== fav.id && c.id !== archive?.id)
    .forEach(c => add(c, 0));
})();
