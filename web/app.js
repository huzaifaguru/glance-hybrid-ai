import { getAuth, signInAnonymously } from 'firebase/auth';
import config from '../glance.config.js';
import { initFirebase } from '../src/core/firebase.js';
import { createEngine } from '../src/core/engine.js';
import { createSharedCache } from '../src/core/cache.js';
import { classifyPrivacy } from '../src/core/heuristics.js';
import { deviceStatus, downloadDeviceModel, STATUS_TEXT } from '../src/core/device.js';
import { blobToJpeg, dataUrlToBlob, sha256Hex } from '../src/core/image.js';
import { renderEntry } from '../src/ui/log.js';
import { rainfallChart, billingNotice, parkScene } from './samples.js';

const $ = (id) => document.getElementById(id);
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
  $('download').disabled = true; $('dl-progress').hidden = false;
  try { await downloadDeviceModel((p) => { $('dl-progress').value = p; }); } catch (e) { $('device-status').textContent = `Download failed: ${e.message}`; }
  $('dl-progress').hidden = true; $('download').disabled = false;
  refreshDevice();
});

// Sample article images, deliberately without alt text.
$('s-chart').src = rainfallChart();
$('s-notice').src = billingNotice();
$('s-scene').src = parkScene();

const lang = () => $('lang').value;

function friendlyError(e) {
  const m = String(e?.message || e);
  if (/App Check|appCheck|401/.test(m)) return 'this site could not be verified by App Check (the site owner needs to allow this domain). Please try again later.';
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(m)) return 'the free AI quota is used up for now. Please try again later.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'no internet connection, and on-device AI is not available on this computer.';
  return m.slice(0, 160);
}
const chosenPrivacy = () => (document.querySelector('input[name="privacy"]:checked').value === 'private'
  ? { private: true, reason: 'You said this image is private' }
  : classifyPrivacy({ hostname: location.hostname, patterns: remote?.sensitivePatterns || [] }));

async function describeBlob(blob, { privacy, title, context, cacheKey, wantDetail }) {
  if (!engine) throw new Error('Glance is still starting');
  const image = await blobToJpeg(blob, remote.maxImagePx);
  const cacheId = privacy.private || !cacheKey ? null : await sha256Hex(`${cacheKey}|${lang()}`);
  const res = await engine.describe({ image, cacheId, privacy, title, context, wantDetail, lang: lang() });
  const li = renderEntry({
    thumb: image.thumb, res,
    onAsk: (question) => engine.ask({ image, privacy, title, context, alt: res.alt, question, lang: lang() }),
    onReport: () => cache.report(cacheId, 'wrong-description'),
  });
  $('log').prepend(li);
  return res;
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const busy = document.createElement('li');
  busy.className = 'entry'; busy.textContent = 'Describing…';
  $('log').prepend(busy);
  try {
    // Uploaded files have no public URL, so they are never written to the shared cache.
    await describeBlob(file, { privacy: chosenPrivacy(), title: 'Uploaded image', context: file.name, cacheKey: null, wantDetail: $('want-detail').checked });
  } catch (e) {
    const err = document.createElement('li'); err.className = 'entry'; err.textContent = `Could not describe: ${friendlyError(e)}`;
    $('log').prepend(err);
  } finally { busy.remove(); }
}

const drop = $('drop');
drop.addEventListener('click', () => $('file').click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
$('file').addEventListener('change', (e) => handleFile(e.target.files[0]));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer.files[0]); });
addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])][0]; if (f) handleFile(f); });

$('fix-article').addEventListener('click', async () => {
  const btn = $('fix-article'); btn.disabled = true; btn.textContent = 'Describing…';
  const title = $('sample').querySelector('h3').textContent;
  for (const img of $('sample').querySelectorAll('img')) {
    const fig = img.closest('figure');
    fig.querySelector('.cap')?.remove();
    try {
      const context = [fig.previousElementSibling?.textContent, fig.nextElementSibling?.textContent].filter(Boolean).join(' ');
      const res = await describeBlob(await dataUrlToBlob(img.src), {
        privacy: classifyPrivacy({ hostname: location.hostname, patterns: remote.sensitivePatterns }),
        title, context, cacheKey: `glance-sample:${img.id}:v1`, wantDetail: false,
      });
      img.alt = res.alt;
      const cap = document.createElement('p'); cap.className = 'cap'; cap.setAttribute('aria-hidden', 'true');
      cap.textContent = `alt = "${res.alt}"${res.detail ? ` · detail: ${res.detail}` : ''}`;
      fig.appendChild(cap);
    } catch (e) {
      console.error(e);
      const err = document.createElement('li'); err.className = 'entry';
      err.textContent = `Could not describe "${img.id}": ${friendlyError(e)}`;
      $('log').prepend(err);
    }
  }
  btn.disabled = false; btn.textContent = 'Describe every image on this page';
});

(async () => {
  await refreshDevice();
  const fb = await initFirebase({ config, env: 'web', signInAnon: async (app) => (await signInAnonymously(getAuth(app))).user });
  remote = fb.remote;
  cache = createSharedCache({ db: fb.db, getUid: () => getAuth(fb.app).currentUser?.uid, enabled: remote.sharedCacheEnabled });
  engine = createEngine({ ai: fb.ai, remote, cache, getDeviceStatus });
})();
