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
