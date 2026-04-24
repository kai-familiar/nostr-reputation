#!/usr/bin/env node
/**
 * nostr-reputation test suite
 */

import {
  KIND, validate, parse, create, tier1Score, tier2Diversity,
  detectBurst, decay, exponentialDecay, gaussianDecay, score,
  DEFAULT_HALF_LIFE, COMMITMENT_CLASSES,
} from './index.js';

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function approx(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }

const NOW = 1700000000;
const DAY = 86400;

function makeEvent(overrides = {}) {
  const attestor = overrides.pubkey || 'a'.repeat(64);
  const subject = overrides.subject || 'b'.repeat(64);
  const context = overrides.context || 'reliability';
  const rating = overrides.rating ?? 4;
  const confidence = overrides.confidence ?? 0.8;

  return {
    kind: KIND,
    pubkey: attestor,
    created_at: overrides.created_at || NOW - DAY,
    content: JSON.stringify({ subject, context, rating, confidence, ...overrides.contentExtra }),
    tags: [
      ['d', `${subject}:${context}`],
      ['p', subject],
      ['t', context],
      ['expiration', String(overrides.expiration || NOW + 90 * DAY)],
      ...(overrides.extraTags || []),
    ],
  };
}

// --- Validation ---
console.log('\n📋 Validation');

assert(validate(makeEvent(), NOW).valid, 'valid event passes');
assert(!validate({ ...makeEvent(), kind: 1 }, NOW).valid, 'wrong kind fails');
assert(!validate({ ...makeEvent(), content: 'not json' }, NOW).valid, 'bad JSON fails');
assert(!validate(makeEvent({ pubkey: 'b'.repeat(64) }), NOW).valid, 'self-attestation fails');
assert(!validate(makeEvent({ expiration: NOW - 1 }), NOW).valid, 'expired event fails');
assert(!validate(makeEvent({ rating: 0 }), NOW).valid, 'rating 0 fails');
assert(!validate(makeEvent({ rating: 6 }), NOW).valid, 'rating 6 fails');
assert(!validate(makeEvent({ confidence: 1.5 }), NOW).valid, 'confidence > 1 fails');
assert(!validate(makeEvent({ confidence: -0.1 }), NOW).valid, 'confidence < 0 fails');

// --- Parsing ---
console.log('\n🔍 Parsing');

const parsed = parse(makeEvent(), { now: NOW });
assert(parsed.attestor === 'a'.repeat(64), 'attestor extracted');
assert(parsed.subject === 'b'.repeat(64), 'subject extracted');
assert(parsed.rating === 4, 'rating extracted');
assert(parsed.confidence === 0.8, 'confidence extracted');
assert(parsed.decay_factor > 0 && parsed.decay_factor <= 1, 'decay computed');

// --- Decay ---
console.log('\n📉 Decay');

assert(approx(exponentialDecay(NOW, NOW), 1.0), 'exponential: age 0 = 1.0');
assert(approx(exponentialDecay(NOW - DEFAULT_HALF_LIFE, NOW), 0.5), 'exponential: halfLife = 0.5');
assert(approx(gaussianDecay(NOW, NOW), 1.0), 'gaussian: age 0 = 1.0');
assert(approx(gaussianDecay(NOW - DEFAULT_HALF_LIFE, NOW), 0.5), 'gaussian: halfLife = 0.5');

const exp2x = exponentialDecay(NOW - 2 * DEFAULT_HALF_LIFE, NOW);
const gau2x = gaussianDecay(NOW - 2 * DEFAULT_HALF_LIFE, NOW);
assert(gau2x < exp2x, 'gaussian drops faster than exponential at 2x halfLife');

assert(approx(decay(NOW - DAY, NOW, DEFAULT_HALF_LIFE, 'exponential'),
              exponentialDecay(NOW - DAY, NOW)), 'decay() dispatches exponential');
assert(approx(decay(NOW - DAY, NOW, DEFAULT_HALF_LIFE, 'gaussian'),
              gaussianDecay(NOW - DAY, NOW)), 'decay() dispatches gaussian');

// --- Scoring ---
console.log('\n📊 Scoring');

const attestations = [
  { rating: 5, confidence: 0.9, created_at: NOW - DAY, commitment_class: 'self_assertion', commitment_weight: 1.0, half_life: DEFAULT_HALF_LIFE },
  { rating: 3, confidence: 0.7, created_at: NOW - 30 * DAY, commitment_class: 'self_assertion', commitment_weight: 1.0, half_life: DEFAULT_HALF_LIFE },
];

const s = tier1Score(attestations, { now: NOW });
assert(s >= 1 && s <= 5, `tier1Score in range: ${s.toFixed(3)}`);
assert(s > 3.5, 'recent high rating dominates');

const sGau = tier1Score(attestations, { now: NOW, decayType: 'gaussian' });
assert(sGau > s || approx(sGau, s, 0.5), 'gaussian score computed');

assert(tier1Score([]) === 0, 'empty attestations = 0');
assert(tier1Score(null) === 0, 'null attestations = 0');

// Commitment weight affects score
const econAttest = [
  { rating: 5, confidence: 0.9, created_at: NOW - DAY, commitment_class: 'economic_settlement', commitment_weight: 1.25, half_life: DEFAULT_HALF_LIFE },
  { rating: 2, confidence: 0.9, created_at: NOW - DAY, commitment_class: 'self_assertion', commitment_weight: 1.0, half_life: DEFAULT_HALF_LIFE },
];
const sEcon = tier1Score(econAttest, { now: NOW });
assert(sEcon > 3.5, 'economic_settlement weighs more than self_assertion');

// --- Diversity ---
console.log('\n🌐 Diversity');

const div1 = tier2Diversity(['a', 'b', 'c', 'd']);
assert(div1.uniqueCount === 4, '4 unique attestors');
assert(div1.entropy > 1.9, 'high entropy for diverse set');
assert(approx(div1.herfindahl, 0.25), 'herfindahl = 0.25 for uniform');

const div2 = tier2Diversity(['a', 'a', 'a', 'a']);
assert(div2.uniqueCount === 1, '1 unique attestor');
assert(div2.entropy === 0, 'zero entropy for single attestor');
assert(div2.herfindahl === 1, 'herfindahl = 1 for monopoly');

assert(tier2Diversity([]).uniqueCount === 0, 'empty = 0 unique');

// --- Burst Detection ---
console.log('\n⚡ Burst Detection');

const normalAttests = Array.from({ length: 5 }, (_, i) => ({ created_at: NOW - i * 7200 }));
assert(!detectBurst(normalAttests), 'normal pace = no burst');

const burstAttests = Array.from({ length: 15 }, (_, i) => ({ created_at: NOW - i * 60 }));
assert(detectBurst(burstAttests), '15 in 15 minutes = burst');

// --- Create ---
console.log('\n🔨 Create');

const evt = create({
  attestor: 'a'.repeat(64),
  subject: 'b'.repeat(64),
  context: 'reliability',
  rating: 4,
  confidence: 0.85,
  commitment: 'economic_settlement',
});
assert(evt.kind === KIND, 'created event has correct kind');
assert(validate(evt).valid, 'created event validates');
assert(JSON.parse(evt.content).commitment_class === 'economic_settlement', 'commitment in content');
assert(evt.tags.some(t => t[0] === 'commitment_class' && t[1] === 'economic_settlement'), 'commitment in tags');

// --- Full score() ---
console.log('\n🎯 Full score()');

const events = [makeEvent(), makeEvent({ pubkey: 'c'.repeat(64), rating: 5 })];
const result = score(events, 'b'.repeat(64), { now: NOW });
assert(result.score > 0, `score() works: ${result.score.toFixed(3)}`);
assert(result.count === 2, `count: ${result.count}`);
assert(result.diversity.uniqueCount === 2, 'diversity included');

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
