import { getAuth, signInAnonymously } from 'firebase/auth/web-extension';
import config from '../glance.config.js';
import { initFirebase } from '../src/core/firebase.js';
import { createEngine } from '../src/core/engine.js';
import { createSharedCache } from '../src/core/cache.js';
import { classifyPrivacy } from '../src/core/heuristics.js';
import { deviceStatus, downloadDeviceModel, STATUS_TEXT } from '../src/core/device.js';
import { blobToJpeg, dataUrlToBlob, sha256Hex } from '../src/core/image.js';
import { renderEntry } from '../src/ui/log.js';

const $ = (id) => document.getElementById(id);
const settings = { enabled: true, showOverlay: true, privateSites: [], strict: false, lang: 'en' };
const stats = { total: 0, device: 0, cloud: 0, cache: 0, private: 0 };
let status = 'unsupported';
let engine; let cache; let remote;

async function refreshDevice() {
  status = await deviceStatus();
  $('device-status').textContent = STATUS_TEXT[status] || status;
  $('device-status').dataset.state = status;
  $('download').hidden = status !== 'downloadable';
  return status;
}
const getDeviceStatus = async () => (status === 'available' ? status : refreshDevice());

$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  $('dl-progress').hidden = false;
  try {
    await downloadDeviceModel((p) => { $('dl-progress').value = p; });
  } catch (e) {
    $('device-status').textContent = `Download failed: ${e.message}`;
  }
  $('dl-progress').hidden = true;
  $('download').disabled = false;
  refreshDevice();
});

// ---------- settings ----------
async function loadSettings() {
  const s = await chrome.storage.local.get(['enabled', 'showOverlay', 'privateSites', 'strict', 'lang', 'stats']);
  for (const k of Object.keys(settings)) if (s[k] !== undefined) settings[k] = s[k];
  if (s.stats) Object.assign(stats, s.stats);
  $('enabled').checked = settings.enabled;
  $('overlay').checked = settings.showOverlay;
  $('strict').checked = settings.strict;
  $('lang').value = settings.lang;
  renderStats();
}
async function saveSettings() {
  await chrome.storage.local.set(settings);
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: 'glance:settings' }).catch(() => {});
  updateSite();
}
$('enabled').addEventListener('change', (e) => { settings.enabled = e.target.checked; saveSettings(); });
$('overlay').addEventListener('change', (e) => { settings.showOverlay = e.target.checked; saveSettings(); });
$('strict').addEventListener('change', (e) => { settings.strict = e.target.checked; saveSettings(); });
$('lang').addEventListener('change', (e) => { settings.lang = e.target.value; saveSettings(); });
$('site-private').addEventListener('change', async (e) => {
  const host = await activeHost();
  if (!host) return;
  settings.privateSites = e.target.checked
    ? [...new Set([...settings.privateSites, host])]
    : settings.privateSites.filter((h) => h !== host);
  saveSettings();
});

async function activeHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { return new URL(tab.url).hostname; } catch { return ''; }
}
async function updateSite() {
  const host = await activeHost();
  $('site-name').textContent = host || '–';
  $('site-private').checked = settings.privateSites.includes(host);
  if (!remote) return;
  const p = classifyPrivacy({ hostname: host, userPrivateSites: settings.privateSites, patterns: remote.sensitivePatterns, strict: settings.strict });
  $('site-privacy').textContent = p.private ? `Private: ${p.reason}. Nothing leaves this device.` : 'Public: complex images may use cloud Gemini.';
  $('site-privacy').dataset.private = String(p.private);
}
chrome.tabs.onActivated.addListener(updateSite);
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') updateSite(); });

function renderStats() {
  $('s-total').textContent = stats.total;
  $('s-device').textContent = stats.device;
  $('s-cloud').textContent = stats.cloud;
  $('s-cache').textContent = stats.cache;
  $('s-private').textContent = stats.private;
}
function countResult(res) {
  stats.total++;
  if (res.source in stats) stats[res.source]++;
  if (res.private) stats.private++;
  renderStats();
  chrome.storage.local.set({ stats });
}

// ---------- describe requests from content scripts ----------
let chain = Promise.resolve(); // Gemini Nano handles one prompt at a time, so requests run in order
const recent = [];

async function loadImage(msg, isPrivate) {
  let blob;
  if (msg.dataUrl) blob = await dataUrlToBlob(msg.dataUrl);
  else {
    const r = await fetch(msg.src, { credentials: isPrivate ? 'include' : 'omit' });
    if (!r.ok) throw new Error(`image fetch ${r.status}`);
    blob = await r.blob();
  }
  return blobToJpeg(blob, remote.maxImagePx);
}

async function handleDescribe(msg) {
  const privacy = classifyPrivacy({
    hostname: msg.hostname, hasPasswordField: msg.hasPasswordField, userPrivateSites: settings.privateSites,
    patterns: remote.sensitivePatterns, srcScheme: msg.srcScheme, strict: settings.strict,
  });
  const image = await loadImage(msg, privacy.private);
  const cacheId = privacy.private ? null : await sha256Hex(`${msg.src}|${settings.lang}`);
  const res = await engine.describe({ image, cacheId, privacy, title: msg.title, context: msg.context, wantDetail: msg.wantDetail, lang: settings.lang });
  countResult(res);

  const item = { image, privacy, title: msg.title, context: msg.context, alt: res.alt };
  recent.unshift(item); if (recent.length > 30) recent.pop();
  $('empty').hidden = true;
  const li = renderEntry({
    thumb: image.thumb,
    res,
    onAsk: (question) => engine.ask({ ...item, question, lang: settings.lang }),
    onReport: () => cache.report(cacheId, 'wrong-description'),
  });
  $('log').prepend(li);
  while ($('log').children.length > 30) $('log').lastChild.remove();
  return { alt: res.alt, detail: res.detail, source: res.source, kind: res.kind };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'glance:describe' || !sender.tab) return false;
  if (!engine) { sendResponse({ error: 'Glance is still starting' }); return false; }
  chain = chain.then(() => handleDescribe(msg)).then(sendResponse, (e) => {
    console.error('[Glance]', e);
    sendResponse({ error: String(e.message || e).slice(0, 160) });
  });
  return true; // async response
});

// ---------- start ----------
(async () => {
  await loadSettings();
  await refreshDevice();
  const fb = await initFirebase({
    config, env: 'extension',
    signInAnon: async (app) => (await signInAnonymously(getAuth(app))).user,
  });
  remote = fb.remote;
  cache = createSharedCache({ db: fb.db, getUid: () => getAuth(fb.app).currentUser?.uid, enabled: remote.sharedCacheEnabled });
  engine = createEngine({ ai: fb.ai, remote, cache, getDeviceStatus });
  updateSite();
  // Tell open tabs that Glance is ready so they (re)queue their unlabeled images.
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: 'glance:ready' }).catch(() => {});
})();
