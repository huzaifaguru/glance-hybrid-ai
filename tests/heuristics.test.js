import { test } from 'node:test';
import assert from 'node:assert/strict';
import { altQuality, needsDescription, classifyPrivacy, quickPassMode, decideDeepPass, parseQuickReply, cleanAlt } from '../src/core/heuristics.js';
import { RC_DEFAULTS } from '../src/core/defaults.js';

const patterns = JSON.parse(RC_DEFAULTS.sensitive_host_patterns);
const escalateKinds = JSON.parse(RC_DEFAULTS.escalate_kinds);

test('alt quality', () => {
  assert.equal(altQuality(null, false), 'missing');
  assert.equal(altQuality('', true), 'empty');
  assert.equal(altQuality('IMG_2041.jpg'), 'poor');
  assert.equal(altQuality('image'), 'poor');
  assert.equal(altQuality('photo 3'), 'poor');
  assert.equal(altQuality('Two volunteers planting a tree by the river'), 'ok');
});

test('needsDescription respects decorative markup and size', () => {
  assert.equal(needsDescription({ alt: null, hasAltAttr: false, width: 300, height: 200 }), true);
  assert.equal(needsDescription({ alt: null, hasAltAttr: false, width: 20, height: 20 }), false);
  assert.equal(needsDescription({ alt: '', hasAltAttr: true, width: 60, height: 60 }), false, 'small alt="" is decorative');
  assert.equal(needsDescription({ alt: '', hasAltAttr: true, width: 600, height: 400 }), true, 'large alt="" is likely a mistake');
  assert.equal(needsDescription({ alt: null, hasAltAttr: false, width: 300, height: 200, ariaHidden: true }), false);
  assert.equal(needsDescription({ alt: null, hasAltAttr: false, width: 300, height: 200, role: 'presentation' }), false);
  assert.equal(needsDescription({ alt: 'A red bicycle leaning on a wall', hasAltAttr: true, width: 300, height: 200 }), false);
});

test('privacy classification', () => {
  assert.equal(classifyPrivacy({ hostname: 'mail.google.com', patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'www.chase-bank.com', patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'photos.google.com', patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'en.wikipedia.org', patterns }).private, false);
  assert.equal(classifyPrivacy({ hostname: 'news.example', hasPasswordField: true, patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'news.example', userPrivateSites: ['news.example'], patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'news.example', srcScheme: 'blob:', patterns }).private, true);
  assert.equal(classifyPrivacy({ hostname: 'en.wikipedia.org', strict: true, patterns }).private, true);
});

test('private pages never route to the cloud', () => {
  assert.equal(quickPassMode({ isPrivate: true, deviceStatus: 'available' }), 'only_on_device');
  assert.equal(quickPassMode({ isPrivate: true, deviceStatus: 'unavailable' }), 'blocked');
  assert.equal(quickPassMode({ isPrivate: false, deviceStatus: 'unavailable' }), 'prefer_on_device');
  const d = decideDeepPass({ isPrivate: true, kind: 'chart', containsText: true, confidence: 0.9, escalateKinds, deviceStatus: 'available' });
  assert.equal(d.next, 'deep_device');
  const blocked = decideDeepPass({ isPrivate: true, kind: 'chart', confidence: 0.9, escalateKinds, deviceStatus: 'unavailable' });
  assert.equal(blocked.next, 'done');
});

test('public complex images escalate to cloud; simple ones do not', () => {
  assert.equal(decideDeepPass({ isPrivate: false, kind: 'chart', containsText: false, confidence: 0.9, escalateKinds }).next, 'deep_cloud');
  assert.equal(decideDeepPass({ isPrivate: false, kind: 'photo', containsText: true, confidence: 0.9, escalateKinds }).next, 'deep_cloud');
  assert.equal(decideDeepPass({ isPrivate: false, kind: 'photo', containsText: false, confidence: 0.3, escalateKinds }).next, 'deep_cloud');
  assert.equal(decideDeepPass({ isPrivate: false, kind: 'photo', containsText: false, confidence: 0.9, escalateKinds }).next, 'done');
  assert.equal(decideDeepPass({ isPrivate: false, wantDetail: true, kind: 'photo', confidence: 0.9, escalateKinds }).next, 'deep_cloud');
});

test('parses model JSON, including fenced and messy replies', () => {
  const r = parseQuickReply('```json\n{"kind":"Chart","contains_text":true,"alt":"Image of a bar chart of monthly rainfall","confidence":0.82}\n```');
  assert.equal(r.kind, 'chart');
  assert.equal(r.containsText, true);
  assert.equal(r.alt, 'A bar chart of monthly rainfall');
  assert.equal(r.confidence, 0.82);
  const f = parseQuickReply('A dog running on a beach.');
  assert.equal(f.parsed, false);
  assert.equal(f.alt, 'A dog running on a beach.');
  assert.ok(cleanAlt('x'.repeat(400)).length <= 160);
});
