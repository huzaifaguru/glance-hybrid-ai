// Pure decision logic shared by the extension, the web demo and the tests.
// No browser or Firebase imports here, so `node --test` can run it directly.

const FILENAME_ALT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;
const GENERIC_ALT = /^(img|image|photo|picture|pic|graphic|untitled|dsc|screenshot|screen shot|banner|thumbnail|icon|logo|null|undefined|alt)[\s_\-]*\d*$/i;

export const MIN_SIZE_PX = 48;
export const LARGE_IMAGE_PX = 200;

/** Classifies existing alt text: 'missing' | 'empty' | 'poor' | 'ok'. */
export function altQuality(alt, hasAltAttr = alt != null) {
  if (!hasAltAttr) return 'missing';
  const a = String(alt).trim();
  if (a === '') return 'empty';
  if (a.length < 4 || FILENAME_ALT.test(a) || GENERIC_ALT.test(a) || /^[\w-]+_\d+$/.test(a)) return 'poor';
  return 'ok';
}

/**
 * Decides whether an image needs a generated description.
 * alt="" is the HTML signal for "decorative", which we respect for small images.
 * Large images marked decorative are usually a site's mistake, so we still describe them.
 */
export function needsDescription({ alt, hasAltAttr, width, height, ariaHidden = false, role = '' }) {
  if (ariaHidden) return false;
  if (role === 'presentation' || role === 'none') return false;
  if (!(width >= MIN_SIZE_PX && height >= MIN_SIZE_PX)) return false;
  const q = altQuality(alt, hasAltAttr);
  if (q === 'ok') return false;
  if (q === 'empty') return width >= LARGE_IMAGE_PX && height >= LARGE_IMAGE_PX;
  return true;
}

export function isSensitiveHost(hostname, patterns = []) {
  const h = String(hostname || '').toLowerCase();
  return patterns.some((p) => {
    try { return new RegExp(p, 'i').test(h); } catch { return false; }
  });
}

/**
 * Decides whether a page is private: anything on it must never leave the device.
 * Returns { private: boolean, reason: string }.
 */
export function classifyPrivacy({ hostname, hasPasswordField = false, userPrivateSites = [], patterns = [], srcScheme = '', strict = false }) {
  if (strict) return { private: true, reason: 'Strict privacy is on' };
  const h = String(hostname || '').toLowerCase();
  if (userPrivateSites.includes(h)) return { private: true, reason: 'You marked this site private' };
  if (isSensitiveHost(h, patterns)) return { private: true, reason: 'Sensitive site (mail, banking, health, personal photos)' };
  if (hasPasswordField) return { private: true, reason: 'Page has a password field' };
  if (srcScheme === 'blob:' || srcScheme === 'data:' || srcScheme === 'file:') return { private: true, reason: 'Image is local or user-generated content' };
  return { private: false, reason: 'Public page' };
}

/** Which inference mode the first (quick) pass may use. */
export function quickPassMode({ isPrivate, deviceStatus }) {
  if (isPrivate) return deviceStatus === 'available' ? 'only_on_device' : 'blocked';
  return 'prefer_on_device';
}

/**
 * After the quick pass, decide if the image deserves a detailed second pass and where it runs.
 * Returns { next: 'done' | 'deep_cloud' | 'deep_device', reason }.
 */
export function decideDeepPass({ isPrivate, wantDetail = false, kind, containsText, confidence, escalateKinds = [], lowConfidence = 0.6, deviceStatus }) {
  const complex = escalateKinds.includes(kind) || containsText === true;
  const unsure = typeof confidence === 'number' && confidence < lowConfidence;
  if (!wantDetail && !complex && !unsure) return { next: 'done', reason: 'Simple image, the on-device description is enough' };
  const why = wantDetail ? 'You asked for detail' : complex ? `Complex image (${containsText ? 'contains text' : kind})` : `Low confidence (${confidence})`;
  if (isPrivate) {
    return deviceStatus === 'available'
      ? { next: 'deep_device', reason: `${why}: detailed pass kept on device because the page is private` }
      : { next: 'done', reason: `${why}, but the page is private and no on-device model is available` };
  }
  return { next: 'deep_cloud', reason: `${why}: sent to Gemini in the cloud for a detailed read` };
}

/** Extracts the JSON object from a model reply. Tolerates code fences and extra prose. */
export function parseQuickReply(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const j = JSON.parse(raw.slice(start, end + 1));
      const alt = cleanAlt(j.alt);
      if (alt) {
        return {
          kind: String(j.kind || 'other').toLowerCase(),
          containsText: j.contains_text === true || j.contains_text === 'true',
          alt,
          confidence: clamp01(Number(j.confidence)),
          parsed: true,
        };
      }
    } catch { /* fall through */ }
  }
  return { kind: 'other', containsText: false, alt: cleanAlt(raw) || 'Image', confidence: 0.4, parsed: false };
}

export function cleanAlt(s) {
  let a = String(s || '').replace(/```[a-z]*|```/gi, '').replace(/\s+/g, ' ').trim();
  a = a.replace(/^(an?\s+)?(image|picture|photo|photograph)\s+(of|showing)\s+/i, '');
  a = a.replace(/^["']|["']$/g, '').trim();
  if (a) a = a[0].toUpperCase() + a.slice(1);
  if (a.length > 160) a = a.slice(0, 157).replace(/\s+\S*$/, '') + '…';
  return a;
}

function clamp01(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

export function normalizeSrc(src) {
  try {
    const u = new URL(src);
    u.hash = '';
    return u.toString();
  } catch { return String(src || ''); }
}
