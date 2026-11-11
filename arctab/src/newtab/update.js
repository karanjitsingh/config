// "Update available" in the homepage footer when GitHub has a newer ArcTab than this one.
// (Plain script sharing globals with the other newtab files; see index.html for load order.)
//
// The repo holds more than ArcTab, so its newest commit (or even the newest commit that
// touched arctab/) says little about what's installed here. Instead this compares files:
// the git blob hash of each file in this extension's folder against arctab/ as of each of
// the last few commits that touched it. The commit whose files are closest to ours is
// what's installed, and the arctab/ commits after it are what's new. Close, not equal: a
// file you're editing locally (or a commit you haven't pushed) still lands on the right
// commit, and leaves nothing to update.
//
// GitHub is asked at most every 6 hours (trees never change, so they're kept); the local
// side is re-hashed on each page load, so the notice clears as soon as you pull.
// Pulled but the extension still runs the old background/content scripts: it offers a
// reload instead.
const RELEASE = { repo: "karanjitsingh/config", branch: "master", dir: "arctab", commits: 8 };
const RELEASE_KEY = "arctabRelease";
const RELEASE_EVERY = 6 * 3600_000;
const RELEASE_RETRY = 30 * 60_000;

async function releaseGh(path) {
  const res = await fetch(`https://api.github.com/repos/${RELEASE.repo}/${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

// What git would call this file's id: sha1("blob <size>\0" + bytes).
async function localBlobSha(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path), { cache: "no-store" });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
    const buf = new Uint8Array(head.length + bytes.length);
    buf.set(head);
    buf.set(bytes, head.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; } // not in this folder
}

// { path: blobSha } of arctab/ in a commit, by the commit's root tree.
async function releaseFiles(rootTree, trees) {
  if (trees[rootTree]) return trees[rootTree];
  const root = await releaseGh(`git/trees/${rootTree}`);
  const dir = root.tree.find(e => e.path === RELEASE.dir && e.type === "tree");
  const files = {};
  if (dir) for (const e of (await releaseGh(`git/trees/${dir.sha}?recursive=1`)).tree) if (e.type === "blob") files[e.path] = e.sha;
  return (trees[rootTree] = files);
}

async function checkRelease() {
  const { [RELEASE_KEY]: saved = {} } = await chrome.storage.local.get(RELEASE_KEY);
  let { commits = [], trees = {}, checkedAt = 0 } = saved;
  if (Date.now() - checkedAt > RELEASE_EVERY || !commits.length) {
    try {
      const list = await releaseGh(`commits?sha=${RELEASE.branch}&path=${RELEASE.dir}&per_page=${RELEASE.commits}`);
      commits = list.map(c => ({ sha: c.sha, tree: c.commit.tree.sha, message: c.commit.message.split("\n")[0], date: c.commit.committer?.date }));
      checkedAt = Date.now();
    } catch (e) {
      console.warn("[arctab] update check", e.message);
      checkedAt = Date.now() - RELEASE_EVERY + RELEASE_RETRY;
      if (!commits.length) return chrome.storage.local.set({ [RELEASE_KEY]: { ...saved, checkedAt } });
    }
  }

  // Newest first; stop at an exact match (the usual case: up to date, or a clean pull behind).
  const local = new Map();
  const shaOf = async p => (local.has(p) ? local.get(p) : (local.set(p, await localBlobSha(p)), local.get(p)));
  let best = -1, bestDiff = Infinity;
  for (let i = 0; i < commits.length; i++) {
    let files;
    try { files = await releaseFiles(commits[i].tree, trees); } catch (e) { console.warn("[arctab] update check", e.message); break; }
    let diff = 0;
    for (const [p, sha] of Object.entries(files)) if ((await shaOf(p)) !== sha) diff++;
    if (diff < bestDiff) { best = i; bestDiff = diff; }
    if (!diff) break;
  }
  const keep = new Set(commits.map(c => c.tree));
  for (const t of Object.keys(trees)) if (!keep.has(t)) delete trees[t];
  await chrome.storage.local.set({ [RELEASE_KEY]: { commits, trees, checkedAt } });
  if (best < 0) return;

  // What the running extension was loaded from: the files as first seen after it (re)loaded.
  const now = Object.fromEntries(local);
  const { arctabRunning } = await chrome.storage.session.get("arctabRunning");
  if (!arctabRunning) await chrome.storage.session.set({ arctabRunning: now });
  const stale = !!arctabRunning && bestDiff === 0 && Object.keys(now).some(p => arctabRunning[p] !== now[p]);

  showRelease({ behind: best, latest: commits[0], stale });
}

function showRelease({ behind, latest, stale }) {
  const chip = document.getElementById("update-chip");
  if (!chip) return;
  if (behind > 0) {
    chip.href = `https://github.com/${RELEASE.repo}/commits/${RELEASE.branch}/${RELEASE.dir}`;
    chip.textContent = `Update available · ${behind} new`;
    chip.title = `Latest: ${latest.message}\nPull the repo, then reload ArcTab.`;
    chip.onclick = null;
  } else if (stale) {
    chip.href = "#";
    chip.textContent = "Reload to finish updating";
    chip.title = "The new files are here; the extension is still running the old ones.";
    chip.onclick = e => { e.preventDefault(); chrome.runtime.reload(); };
  } else return chip.classList.add("hidden");
  chip.classList.remove("hidden");
}

if (!IN_INCOGNITO) {
  const run = () => checkRelease().catch(e => console.warn("[arctab] update check", e.message));
  (window.requestIdleCallback || setTimeout)(run, { timeout: 3000 });
}
