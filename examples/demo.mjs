#!/usr/bin/env node
/**
 * nostr-reputation demo — runs in 30 seconds, no dependencies beyond nostr-reputation
 * 
 * Shows: create → validate → parse → score → diversity analysis
 * No relay connections needed — pure local computation.
 * 
 * Run: node examples/demo.mjs
 */

import {
  create, validate, parse, score,
  tier1Score, tier2Diversity, detectBurst,
  exponentialDecay, gaussianDecay,
  KIND, COMMITMENT_CLASSES,
} from '../index.js';

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

// Simulated pubkeys (in production these would be real Nostr keypairs)
const alice = 'a'.repeat(64);  // attestor 1
const bob   = 'b'.repeat(64);  // attestor 2  
const carol = 'c'.repeat(64);  // attestor 3
const dave  = 'd'.repeat(64);  // the subject being rated

console.log('━━━ nostr-reputation demo ━━━\n');

// ── 1. Create attestations ──────────────────────────────────────
console.log('1. Creating attestations...\n');

const attestations = [
  create({
    attestor: alice,
    subject: dave,
    context: 'reliability',
    rating: 5,
    confidence: 0.9,
    commitment: 'economic_settlement',
    evidence: ['Paid via L402, service delivered correctly'],
  }),
  create({
    attestor: bob,
    subject: dave,
    context: 'reliability',
    rating: 4,
    confidence: 0.7,
    commitment: 'social_endorsement',
  }),
  create({
    attestor: carol,
    subject: dave,
    context: 'code.review',
    rating: 3,
    confidence: 0.85,
    commitment: 'computational_proof',
    evidence: ['PR #42 reviewed — works but needs tests'],
  }),
];

// Backdate the events to show decay effects
attestations[0].created_at = NOW - 1 * DAY;   // 1 day old
attestations[1].created_at = NOW - 30 * DAY;  // 30 days old
attestations[2].created_at = NOW - 7 * DAY;   // 7 days old

for (const a of attestations) {
  const content = JSON.parse(a.content);
  console.log(`  ${a.pubkey.slice(0,8)}... → ${content.subject.slice(0,8)}...`);
  console.log(`    Context: ${content.context} | Rating: ${'★'.repeat(content.rating)}${'☆'.repeat(5-content.rating)} | Confidence: ${(content.confidence*100).toFixed(0)}%`);
  console.log(`    Commitment: ${content.commitment_class || 'self_assertion'}`);
  if (content.evidence) console.log(`    Evidence: "${content.evidence[0]}"`);
  console.log();
}

// ── 2. Validate ─────────────────────────────────────────────────
console.log('2. Validating attestations...\n');

for (const a of attestations) {
  const result = validate(a);
  const content = JSON.parse(a.content);
  console.log(`  ${content.context} from ${a.pubkey.slice(0,8)}...: ${result.valid ? '✅ valid' : `❌ ${result.error}`}`);
}

// Self-attestation check
const selfAttest = create({ attestor: dave, subject: dave, context: 'reliability', rating: 5, confidence: 1.0 });
const selfResult = validate(selfAttest);
console.log(`  Self-attestation: ${selfResult.valid ? '✅ valid' : `❌ ${selfResult.error}`}`);
console.log();

// ── 3. Parse with decay ─────────────────────────────────────────
console.log('3. Parsing with temporal decay...\n');

const parsed = attestations.map(a => parse(a, { now: NOW }));
for (const p of parsed) {
  const age = Math.round((NOW - p.created_at) / DAY);
  console.log(`  ${p.context} | Rating: ${p.rating}/5 | Decay: ${(p.decay_factor*100).toFixed(1)}% (${age}d old) | Weight: ${p.commitment_class} (×${p.commitment_weight})`);
}
console.log();

// ── 4. Score ────────────────────────────────────────────────────
console.log('4. Scoring...\n');

// Score all contexts
const expScore = tier1Score(parsed, { now: NOW, decayType: 'exponential' });
const gauScore = tier1Score(parsed, { now: NOW, decayType: 'gaussian' });
console.log(`  Overall (exponential decay): ${expScore.toFixed(2)}/5.0`);
console.log(`  Overall (gaussian decay):    ${gauScore.toFixed(2)}/5.0`);
console.log(`  → Gaussian weights recent attestations more heavily\n`);

// Score by context
const reliabilityParsed = parsed.filter(p => p.context === 'reliability');
const codeReviewParsed = parsed.filter(p => p.context === 'code.review');
console.log(`  Reliability: ${tier1Score(reliabilityParsed, { now: NOW }).toFixed(2)}/5.0 (${reliabilityParsed.length} attestations)`);
console.log(`  Code review: ${tier1Score(codeReviewParsed, { now: NOW }).toFixed(2)}/5.0 (${codeReviewParsed.length} attestations)`);
console.log();

// ── 5. One-call score() ─────────────────────────────────────────
console.log('5. One-call score() with full analysis...\n');

const result = score(attestations, dave, { now: NOW });
console.log(`  Score: ${result.score.toFixed(2)}/5.0`);
console.log(`  Attestations: ${result.count}`);
console.log(`  Unique attestors: ${result.diversity.uniqueCount}`);
console.log(`  Entropy: ${result.diversity.entropy.toFixed(2)} (higher = more diverse)`);
console.log(`  Herfindahl: ${result.diversity.herfindahl.toFixed(3)} (lower = more diverse)`);
console.log();

// ── 6. Diversity & Sybil detection ─────────────────────────────
console.log('6. Sybil resistance analysis...\n');

const healthyDiv = tier2Diversity([alice, bob, carol]);
console.log(`  Healthy (3 unique attestors):`);
console.log(`    Entropy: ${healthyDiv.entropy.toFixed(2)} | Herfindahl: ${healthyDiv.herfindahl.toFixed(3)}`);

const sybilDiv = tier2Diversity([alice, alice, alice, bob]);
console.log(`  Suspicious (1 dominates):`);
console.log(`    Entropy: ${sybilDiv.entropy.toFixed(2)} | Herfindahl: ${sybilDiv.herfindahl.toFixed(3)}`);
console.log(`    → High Herfindahl (>0.5) = possible Sybil attack`);
console.log();

// ── 7. Burst detection ──────────────────────────────────────────
console.log('7. Burst detection...\n');

const normalPace = Array.from({length: 5}, (_, i) => ({ created_at: NOW - i * 7200 }));
const burstPace = Array.from({length: 15}, (_, i) => ({ created_at: NOW - i * 60 }));
console.log(`  5 attestations over 10 hours: ${detectBurst(normalPace) ? '⚠️ BURST' : '✅ normal'}`);
console.log(`  15 attestations in 15 minutes: ${detectBurst(burstPace) ? '⚠️ BURST' : '✅ normal'}`);
console.log();

// ── 8. Decay comparison ─────────────────────────────────────────
console.log('8. Decay comparison (2-week half-life)...\n');

const halfLife = 14 * DAY;
const ages = [0, 7, 14, 28, 42];
console.log('  Age (days)  Exponential  Gaussian');
console.log('  ─────────  ───────────  ────────');
for (const age of ages) {
  const exp = exponentialDecay(NOW - age * DAY, NOW, halfLife);
  const gau = gaussianDecay(NOW - age * DAY, NOW, halfLife);
  console.log(`  ${String(age).padStart(9)}  ${(exp*100).toFixed(1).padStart(10)}%  ${(gau*100).toFixed(1).padStart(7)}%`);
}
console.log();

console.log('━━━ Done. Spec: github.com/nostr-protocol/nips/pull/2320 ━━━');
