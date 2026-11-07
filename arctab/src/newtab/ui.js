// Small UI building blocks: DOM helpers, the link editor dialog, context menu, toast.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)

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

// ---------- small UI helpers ----------

function icon(url, size, title) {
  const img = el("img", { src: favicon(url, size * 2), alt: "", width: size, height: size });
  img.onerror = () => img.replaceWith(el("i", {
    className: "letter",
    style: `width:${size}px;height:${size}px;font-size:${size * 0.6}px`,
    textContent: (title || hostOf(url) || "?")[0].toUpperCase(),
  }));
  return img;
}

function actBtn(label, title, onClick, extraClass = "") {
  const b = el("button", { type: "button", className: `act ${extraClass}`, title, textContent: label });
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); onClick(); });
  return b;
}

const editor = $("#editor");
function openEditor({ heading, title = "", url = "", emoji = "", folder = false }) {
  const f = editor.querySelector("form");
  const fTitle = f.elements.namedItem("title");
  const fUrl = f.elements.namedItem("url");
  const fEmoji = f.elements.namedItem("emoji");
  $("#ed-heading").textContent = heading;
  fTitle.value = title;
  fUrl.value = url;
  fEmoji.value = emoji;
  $("#ed-url-row").classList.toggle("hidden", folder);
  $("#ed-emoji-row").classList.toggle("hidden", folder);
  editor.returnValue = "";
  editor.showModal();
  (folder || title ? fTitle : fUrl).select();
  return new Promise(resolve => {
    editor.addEventListener("close", () => {
      if (editor.returnValue !== "ok") return resolve(null);
      const t = fTitle.value.trim();
      const u = normalizeUrl(fUrl.value);
      if (folder ? !t : !u) return resolve(null);
      const name = t || hostOf(u);
      const e = folder ? "" : firstEmoji(fEmoji.value);
      resolve({ title: e ? `${e} ${name}` : name, url: u });
    }, { once: true });
  });
}

// Every dialog closes on a click outside it, like Esc. Both press and release must land
// outside, so a text selection that ends past the edge doesn't close it.
for (const dlg of document.querySelectorAll("dialog")) {
  const outside = e => {
    const r = dlg.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let downOutside = false;
  dlg.addEventListener("mousedown", e => { downOutside = e.target === dlg && outside(e); });
  dlg.addEventListener("click", e => {
    if (downOutside && e.target === dlg && outside(e)) dlg.close();
    downOutside = false;
  });
}

// ---------- context menu ----------
const menu = el("div", { id: "ctxmenu", className: "hidden", role: "menu", tabIndex: -1 });
document.body.append(menu);
const hideMenu = () => menu.classList.add("hidden");

function showMenu(x, y, items) {
  menu.replaceChildren(...items.map(([label, fn, cls = ""]) => {
    const b = el("button", { type: "button", className: cls, textContent: label, role: "menuitem" });
    b.addEventListener("click", () => { hideMenu(); fn(); });
    return b;
  }));
  menu.classList.remove("hidden");
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  menu.focus(); // nothing preselected; ↑/↓ start moving through the items
}
menu.addEventListener("keydown", e => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...menu.querySelectorAll("button")];
  const i = items.indexOf(document.activeElement);
  const next = i === -1 ? (e.key === "ArrowDown" ? 0 : items.length - 1)
    : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next].focus();
});
document.addEventListener("mousedown", e => { if (!menu.contains(e.target)) hideMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") hideMenu(); });
addEventListener("blur", hideMenu);
addEventListener("scroll", hideMenu, true);
addEventListener("resize", hideMenu);

// Slides up from the bottom, fades out on its own (longer when there's an Undo), and
// stays while hovered. A new toast replaces the current one in place.
let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  const hide = () => t.classList.remove("show");
  const arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(hide, undo ? 5000 : 2500); };
  t.querySelector("span").textContent = msg;
  t.classList.toggle("error", /^couldn't|failed|error/i.test(msg));
  const b = t.querySelector("button");
  b.classList.toggle("hidden", !undo);
  b.onclick = async () => { hide(); await undo(); };
  t.onmouseenter = () => clearTimeout(toastTimer);
  t.onmouseleave = arm;
  if (t.classList.contains("show")) { t.classList.remove("bump"); void t.offsetWidth; t.classList.add("bump"); }
  t.classList.add("show");
  arm();
}
