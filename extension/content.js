// Content script: finds unlabeled images, asks the Glance side panel to describe them,
// writes the result into the page's accessibility tree (alt), and announces it to screen readers.
import { needsDescription, normalizeSrc } from '../src/core/heuristics.js';

const state = {
  queue: [],
  busy: false,
  seen: new WeakSet(),
  results: new WeakMap(),
  panelMissingAnnounced: false,
  lastHovered: null,
  settings: { enabled: true, showOverlay: true, privateSites: [], strict: false, lang: 'en' },
  described: 0,
};

// ---------- screen reader announcements ----------
const live = document.createElement('div');
live.setAttribute('aria-live', 'polite');
live.setAttribute('role', 'status');
live.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;left:-9999px;';
document.documentElement.appendChild(live);
let announceTimer;
function announce(text, urgent = false) {
  live.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
  live.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => { live.textContent = text; }, 60);
}

// ---------- visual captions (for sighted helpers, demos and QA) ----------
const host = document.createElement('div');
host.setAttribute('aria-hidden', 'true');
host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
const shadow = host.attachShadow({ mode: 'closed' });
shadow.innerHTML = `<style>
  .chip{position:absolute;max-width:min(420px,90vw);font:500 12px/1.35 system-ui,sans-serif;color:#0b1020;
    background:#fff8d6;border:1px solid #c9a400;border-radius:8px;padding:6px 8px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
  .chip b{display:inline-block;font-size:10px;letter-spacing:.04em;text-transform:uppercase;border-radius:4px;padding:1px 5px;margin-right:6px;color:#fff}
  .device b{background:#137333}.cloud b{background:#1a56db}.cache b{background:#7a3dd8}.blocked b{background:#8a1c1c}.pending b{background:#666}
</style>`;
document.documentElement.appendChild(host);
const chips = new Map();

const BADGE = { device: 'On device', cloud: 'Cloud', cache: 'Shared', blocked: 'Private', pending: 'Glance…' };
function setChip(img, source, text) {
  if (!state.settings.showOverlay) return;
  let chip = chips.get(img);
  if (!chip) {
    chip = document.createElement('div');
    shadow.appendChild(chip);
    chips.set(img, chip);
  }
  chip.className = `chip ${source}`;
  chip.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = BADGE[source] || source;
  chip.append(b, document.createTextNode(text));
  positionChips();
}
let rafPending = false;
function positionChips() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    for (const [img, chip] of chips) {
      if (!img.isConnected) { chip.remove(); chips.delete(img); continue; }
      const r = img.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      chip.style.display = visible && state.settings.showOverlay ? 'block' : 'none';
      chip.style.left = `${Math.max(4, r.left + window.scrollX + 6)}px`;
      chip.style.top = `${r.top + window.scrollY + 6}px`;
    }
  });
}
addEventListener('scroll', positionChips, { passive: true });
addEventListener('resize', positionChips);

// ---------- privacy signals gathered on the page ----------
function pageSignals() {
  return {
    hostname: location.hostname,
    hasPasswordField: !!document.querySelector('input[type="password"]'),
    title: document.title,
  };
}

function nearbyText(img) {
  const fig = img.closest('figure');
  const cap = fig?.querySelector('figcaption')?.innerText;
  const link = img.closest('a')?.getAttribute('aria-label') || img.closest('a')?.innerText;
  const title = img.getAttribute('title');
  let heading = '';
  let el = img;
  for (let i = 0; i < 6 && el && !heading; i++) {
    el = el.parentElement;
    heading = el?.querySelector?.('h1,h2,h3')?.innerText || '';
  }
  return [cap, title, link, heading].filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 400);
}

function srcOf(img) {
  return img.currentSrc || img.src || '';
}

async function readImageData(src) {
  // Same-origin, data: and blob: images are read here so cookies and page-local URLs work.
  // Anything else is fetched by the extension panel, which has host permissions (no CORS limits).
  const u = new URL(src, location.href);
  if (u.protocol === 'data:') return src;
  if (u.protocol === 'blob:' || u.origin === location.origin) {
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
    } catch { return null; }
  }
  return null;
}

// ---------- queue ----------
function consider(img) {
  if (state.seen.has(img) || !state.settings.enabled) return;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const ok = needsDescription({
    alt: img.getAttribute('alt'),
    hasAltAttr: img.hasAttribute('alt'),
    width: Math.min(w, img.clientWidth || w),
    height: Math.min(h, img.clientHeight || h),
    ariaHidden: img.closest('[aria-hidden="true"]') != null,
    role: img.getAttribute('role') || '',
  });
  if (!ok || !srcOf(img)) return;
  state.seen.add(img);
  state.queue.push({ img, wantDetail: false });
  pump();
}

async function request(img, wantDetail) {
  const src = srcOf(img);
  const sig = pageSignals();
  const dataUrl = await readImageData(src);
  return chrome.runtime.sendMessage({
    type: 'glance:describe',
    src: normalizeSrc(new URL(src, location.href).href),
    dataUrl,
    pageUrl: location.href,
    srcScheme: new URL(src, location.href).protocol,
    context: nearbyText(img),
    wantDetail,
    ...sig,
  });
}

async function pump() {
  if (state.busy) return;
  const job = state.queue.shift();
  if (!job) return;
  state.busy = true;
  const { img, wantDetail } = job;
  setChip(img, 'pending', 'Describing…');
  try {
    const res = await request(img, wantDetail);
    if (!res) throw new Error('no-panel');
    if (res.error) throw new Error(res.error);
    apply(img, res, wantDetail);
  } catch (e) {
    if (String(e.message).includes('Receiving end') || e.message === 'no-panel') {
      // Panel closed: put the job back and tell the user once how to start Glance.
      state.seen.delete(img);
      chips.get(img)?.remove(); chips.delete(img);
      for (const j of state.queue) state.seen.delete(j.img);
      state.queue = [];
      if (!state.panelMissingAnnounced) {
        state.panelMissingAnnounced = true;
        announce('Glance found images without descriptions. Press Alt Shift G to open Glance and describe them.');
      }
    } else {
      setChip(img, 'blocked', `Could not describe: ${e.message}`.slice(0, 120));
    }
  } finally {
    state.busy = false;
    if (state.queue.length) pump();
  }
}

function apply(img, res, wantDetail) {
  if (!img.hasAttribute('data-glance-original-alt')) img.setAttribute('data-glance-original-alt', img.getAttribute('alt') ?? '');
  img.setAttribute('alt', res.alt);
  img.setAttribute('data-glance', res.source);
  state.results.set(img, res);
  setChip(img, res.source, res.alt);
  state.described++;
  if (wantDetail) {
    announce(`${res.alt}. ${res.detail || ''}`, true);
  } else if (state.described % 5 === 1) {
    announce(`Glance described ${state.described} image${state.described > 1 ? 's' : ''} on this page.`);
  }
}

// Describe images as they come into view (cheaper and faster than the whole page at once).
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const img = e.target;
      if (img.complete) consider(img); else img.addEventListener('load', () => consider(img), { once: true });
    }
  }
}, { rootMargin: '400px' });

function observeAll(root = document) {
  root.querySelectorAll?.('img').forEach((img) => io.observe(img));
}
new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') io.observe(n); else observeAll(n);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('mouseover', (e) => {
  if (e.target instanceof HTMLImageElement) state.lastHovered = e.target;
}, { passive: true });

function focusedImage() {
  const a = document.activeElement;
  if (a instanceof HTMLImageElement) return a;
  const inner = a?.querySelector?.('img');
  if (inner) return inner;
  if (state.lastHovered?.isConnected) return state.lastHovered;
  // Fall back to the largest image near the middle of the screen.
  let best = null; let bestScore = 0;
  for (const img of document.images) {
    const r = img.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width < 48) continue;
    const score = r.width * r.height / (1 + Math.abs(r.top + r.height / 2 - innerHeight / 2));
    if (score > bestScore) { best = img; bestScore = score; }
  }
  return best;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'glance:describe-focused') {
    const img = focusedImage();
    if (!img) { announce('No image found near your focus.', true); return; }
    const prev = state.results.get(img);
    if (prev?.detail) { announce(`${prev.alt}. ${prev.detail}`, true); return; }
    announce('Describing image in detail…', true);
    state.seen.add(img);
    state.queue.unshift({ img, wantDetail: true });
    pump();
  } else if (msg?.type === 'glance:ready') {
    state.panelMissingAnnounced = false;
    observeAll();
    for (const img of document.images) { if (!state.seen.has(img)) { io.unobserve(img); io.observe(img); } }
  } else if (msg?.type === 'glance:settings') {
    loadSettings();
  } else if (msg?.type === 'glance:page-info') {
    sendResponse({ hostname: location.hostname, title: document.title, described: state.described });
  }
});

async function loadSettings() {
  const s = await chrome.storage.local.get(['enabled', 'showOverlay', 'privateSites', 'strict', 'lang']);
  Object.assign(state.settings, Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)));
  positionChips();
}

loadSettings().then(() => observeAll());
