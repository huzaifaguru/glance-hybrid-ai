import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';
import { getFirestore } from 'firebase/firestore';
import { getRemoteConfig, fetchAndActivate, getValue } from 'firebase/remote-config';
import { RC_DEFAULTS } from './defaults.js';

/**
 * Starts Firebase for either the web demo or the extension.
 * signInAnon is passed in because the extension must use 'firebase/auth/web-extension'
 * (MV3 forbids remotely hosted code) while the web demo uses 'firebase/auth'.
 */
export async function initFirebase({ config, env, signInAnon }) {
  if (config.appCheckDebugToken) self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.appCheckDebugToken;
  const app = initializeApp(config.firebase);

  // Extension pages can't load reCAPTCHA, so they use a registered App Check debug token
  // (the contest rules accept debug tokens). The hosted web demo uses reCAPTCHA Enterprise.
  const provider = env === 'web' && config.recaptchaEnterpriseSiteKey && !config.appCheckDebugToken
    ? new ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey)
    : new CustomProvider({ getToken: () => Promise.reject(new Error('No App Check attestation provider: set appCheckDebugToken')) });
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const db = getFirestore(app);

  let user = null;
  try { user = await signInAnon(app); } catch (e) { console.warn('[Glance] anonymous sign-in failed', e); }

  const rc = getRemoteConfig(app);
  rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
  rc.defaultConfig = RC_DEFAULTS;
  try { await fetchAndActivate(rc); } catch (e) { console.warn('[Glance] remote config fetch failed, using defaults', e); }

  return { app, ai, db, user, remote: readRemote(rc) };
}

function readRemote(rc) {
  const str = (k) => getValue(rc, k).asString() || RC_DEFAULTS[k];
  const json = (k) => { try { return JSON.parse(str(k)); } catch { return JSON.parse(RC_DEFAULTS[k]); } };
  return {
    sensitivePatterns: json('sensitive_host_patterns'),
    escalateKinds: json('escalate_kinds'),
    cloudQuickModel: str('cloud_quick_model'),
    cloudDeepModel: str('cloud_deep_model'),
    lowConfidence: Number(str('low_confidence')) || 0.6,
    sharedCacheEnabled: str('shared_cache_enabled') === 'true',
    maxImagePx: Number(str('max_image_px')) || 768,
  };
}
