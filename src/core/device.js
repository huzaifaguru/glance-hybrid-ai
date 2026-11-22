// Chrome built-in AI (Gemini Nano) availability helpers.
const OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

/** 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' */
export async function deviceStatus() {
  if (typeof LanguageModel === 'undefined') return 'unsupported';
  try {
    return await LanguageModel.availability(OPTS);
  } catch {
    return 'unavailable';
  }
}

/** Downloads Gemini Nano. Chrome requires this to start from a user gesture (a click). */
export async function downloadDeviceModel(onProgress = () => {}) {
  const session = await LanguageModel.create({
    ...OPTS,
    monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress(e.loaded)); },
  });
  session.destroy?.();
}

export const STATUS_TEXT = {
  available: 'Gemini Nano ready on this device',
  downloadable: 'Gemini Nano can be downloaded (one time)',
  downloading: 'Gemini Nano is downloading…',
  unavailable: 'This device cannot run Gemini Nano, so cloud fallback only',
  unsupported: 'Browser has no on-device AI, so cloud fallback only',
};
