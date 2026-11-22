import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Shared Firestore cache of descriptions for images on PUBLIC pages.
 * When one person's browser has described an image, every other user gets it instantly at no cost.
 * Images from private pages are never written here (callers enforce this, and the doc id is
 * a hash, so the database never stores the URL itself).
 */
export function createSharedCache({ db, getUid, enabled }) {
  return {
    async get(id) {
      if (!enabled || !id || !getUid()) return null;
      try {
        const snap = await getDoc(doc(db, 'altCache', id));
        return snap.exists() ? snap.data() : null;
      } catch (e) { console.warn('[Glance] cache read failed', e); return null; }
    },
    async put(id, entry) {
      if (!enabled || !id || !getUid()) return;
      try {
        await setDoc(doc(db, 'altCache', id), {
          alt: entry.alt.slice(0, 300),
          detail: entry.detail ? entry.detail.slice(0, 2000) : null,
          kind: String(entry.kind || 'other').slice(0, 20),
          source: entry.source === 'cloud' ? 'cloud' : 'device',
          lang: entry.lang,
          uid: getUid(),
          createdAt: serverTimestamp(),
        });
      } catch (e) { console.warn('[Glance] cache write failed', e); }
    },
    async report(id, reason) {
      if (!getUid()) return;
      try {
        await addDoc(collection(db, 'feedback'), { cacheId: id || null, reason: String(reason).slice(0, 40), uid: getUid(), createdAt: serverTimestamp() });
      } catch (e) { console.warn('[Glance] feedback failed', e); }
    },
  };
}
