// Remote Config defaults. Every value can be changed live from the Firebase console
// without shipping a new extension build.
export const RC_DEFAULTS = {
  sensitive_host_patterns: JSON.stringify([
    '^mail\\.', 'outlook\\.(live|office)\\.com$', 'bank', 'paypal\\.com$', 'venmo\\.com$',
    'health', 'mychart', 'patient', 'clinic', 'hospital',
    '^photos\\.google\\.com$', '^drive\\.google\\.com$', '^docs\\.google\\.com$',
    '^web\\.whatsapp\\.com$', 'messenger\\.com$', '^web\\.telegram\\.org$', 'icloud\\.com$',
    'dropbox\\.com$', 'onedrive\\.live\\.com$', 'facebook\\.com$', 'instagram\\.com$',
  ]),
  escalate_kinds: JSON.stringify(['chart', 'diagram', 'map', 'screenshot', 'document']),
  cloud_quick_model: 'gemini-3.5-flash-lite',
  cloud_deep_model: 'gemini-3.5-flash-lite',
  low_confidence: '0.6',
  shared_cache_enabled: 'true',
  max_image_px: '768',
};

export const LANGUAGES = { en: 'English', es: 'Spanish', ja: 'Japanese' };
