import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { quickPassMode, decideDeepPass, parseQuickReply, cleanAlt } from './heuristics.js';
import { quickPrompt, detailPrompt, askPrompt } from './prompts.js';

/**
 * The Glance hybrid engine.
 *
 * Every image goes through up to three steps, and each step records where it ran:
 *   1. shared cache (Firestore), public pages only
 *   2. quick pass: Gemini Nano on the device writes the alt text and classifies the image.
 *      PREFER_ON_DEVICE on public pages, ONLY_ON_DEVICE on private pages.
 *   3. deep pass, only for complex images (charts, screenshots, text): cloud Gemini on public
 *      pages, Gemini Nano on private pages.
 */
export function createEngine({ ai, remote, cache, getDeviceStatus }) {
  const models = new Map();

  function model(pass, mode, lang) {
    const cloudModel = pass === 'deep' ? remote.cloudDeepModel : remote.cloudQuickModel;
    const key = `${pass}|${mode}|${lang}|${cloudModel}`;
    if (!models.has(key)) {
      models.set(key, getGenerativeModel(ai, {
        mode,
        onDeviceParams: {
          createOptions: {
            expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
            expectedOutputs: [{ type: 'text', languages: [lang] }],
          },
        },
        inCloudParams: {
          model: cloudModel,
          generationConfig: { temperature: 0.2, maxOutputTokens: pass === 'deep' ? 700 : 256 },
        },
      }));
    }
    return models.get(key);
  }

  async function run(pass, mode, lang, prompt, image) {
    const t0 = performance.now();
    const result = await model(pass, mode, lang).generateContent([
      { type: 'text', text: prompt },
      { type: 'inlineData', inlineData: { data: image.data, mimeType: image.mimeType } },
    ]);
    const r = result.response;
    const src = r.inferenceSource || (mode === InferenceMode.ONLY_ON_DEVICE ? 'on_device' : 'in_cloud');
    return { text: r.text(), source: src === 'on_device' ? 'device' : 'cloud', ms: Math.round(performance.now() - t0) };
  }

  /**
   * @param {object} req
   * @param {{data:string,mimeType:string}} req.image  normalized JPEG
   * @param {string|null} req.cacheId  hash of the image URL (null for private/local images)
   * @param {{private:boolean, reason:string}} req.privacy
   * @param {string} req.title  page title
   * @param {string} req.context  text near the image
   * @param {boolean} req.wantDetail  user explicitly asked for a detailed description
   * @param {string} req.lang
   */
  async function describe(req) {
    const { image, cacheId, privacy, title, context, wantDetail = false, lang = 'en' } = req;
    const steps = [];
    const deviceStatus = await getDeviceStatus();
    const isPrivate = privacy.private;
    steps.push({ step: 'privacy', label: isPrivate ? 'Private, stays on this device' : 'Public, cloud allowed', detail: privacy.reason });

    // 1. Shared cache
    if (!isPrivate && cacheId) {
      const hit = await cache.get(cacheId);
      if (hit && (!wantDetail || hit.detail)) {
        steps.push({ step: 'cache', label: 'Shared cache hit', detail: 'Already described for someone else, so 0 model calls', source: 'cache' });
        return { alt: hit.alt, detail: hit.detail, kind: hit.kind, source: 'cache', steps, private: false };
      }
      steps.push({ step: 'cache', label: 'Shared cache miss', detail: 'First time anyone has seen this image' });
    }

    // 2. Quick pass
    const qMode = quickPassMode({ isPrivate, deviceStatus });
    if (qMode === 'blocked') {
      steps.push({ step: 'quick', label: 'Blocked', detail: 'Private page and Gemini Nano is not available here, so nothing was sent to the cloud' });
      return { alt: 'Image (Glance kept this private: on-device AI is not available)', detail: null, kind: 'other', source: 'blocked', steps, private: true };
    }
    const q = await run('quick', qMode, lang, quickPrompt({ title, context, lang }), image);
    const quick = parseQuickReply(q.text);
    steps.push({
      step: 'quick', source: q.source, ms: q.ms,
      label: q.source === 'device' ? 'Quick pass on Gemini Nano' : 'Quick pass on cloud Gemini (fallback)',
      detail: `${quick.kind}${quick.containsText ? ', contains text' : ''}, confidence ${quick.confidence.toFixed(2)}`,
    });

    let detail = null;
    let finalSource = q.source;

    // 3. Optional deep pass
    const plan = decideDeepPass({
      isPrivate, wantDetail, kind: quick.kind, containsText: quick.containsText, confidence: quick.confidence,
      escalateKinds: remote.escalateKinds, lowConfidence: remote.lowConfidence, deviceStatus,
    });
    if (plan.next !== 'done') {
      const mode = plan.next === 'deep_cloud' ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.ONLY_ON_DEVICE;
      try {
        const d = await run('deep', mode, lang, detailPrompt({ title, context, alt: quick.alt, kind: quick.kind, lang }), image);
        detail = cleanAlt(d.text).length > 0 ? d.text.replace(/\s+/g, ' ').trim() : null;
        finalSource = d.source === 'cloud' || q.source === 'cloud' ? 'cloud' : 'device';
        steps.push({ step: 'deep', source: d.source, ms: d.ms, label: d.source === 'cloud' ? 'Detailed read on cloud Gemini' : 'Detailed read on Gemini Nano', detail: plan.reason });
      } catch (e) {
        steps.push({ step: 'deep', label: 'Detailed pass failed', detail: String(e.message || e).slice(0, 140) });
      }
    } else {
      steps.push({ step: 'deep', label: 'No detailed pass needed', detail: plan.reason });
    }

    const out = { alt: quick.alt, detail, kind: quick.kind, source: finalSource, steps, private: isPrivate };
    if (!isPrivate && cacheId) cache.put(cacheId, { ...out, lang });
    return out;
  }

  async function ask({ image, privacy, title, context, alt, question, lang = 'en' }) {
    const deviceStatus = await getDeviceStatus();
    const mode = quickPassMode({ isPrivate: privacy.private, deviceStatus });
    if (mode === 'blocked') return { text: 'This page is private and on-device AI is not available, so Glance will not send the image anywhere.', source: 'blocked' };
    return run('deep', mode, lang, askPrompt({ title, context, alt, question, lang }), image);
  }

  return { describe, ask };
}
