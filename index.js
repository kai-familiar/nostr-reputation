/**
 * nostr-reputation — Kind 30085 Agent Reputation Attestations
 *
 * Create, validate, score, and analyze trust attestations on Nostr.
 * Zero dependencies. Pure ES modules.
 *
 * Spec: https://github.com/nostr-protocol/nips/pull/2320
 *
 * @module nostr-reputation
 */

// ============================================================================
// Constants
// ============================================================================

export const KIND = 30085;
export const DEFAULT_HALF_LIFE = 7_776_000; // 90 days in seconds

export const HALF_LIFE_CLASSES = {
  slow: 15_552_000,     // 180 days
  standard: 7_776_000,  // 90 days
  fast: 2_592_000,      // 30 days
};

// Commitment class weights (Grafen/Zahavi signaling theory)
export const COMMITMENT_CLASSES = {
  self_assertion: 1.0,
  social_endorsement: 1.05,
  computational_proof: 1.1,
  time_lock: 1.15,
  economic_settlement: 1.25,
};

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a Kind 30085 event against all 10 NIP-XX rules.
 *
 * @param {Object} event - Nostr event object
 * @param {number} [now] - Reference timestamp (defaults to current time)
 * @returns {{ valid: boolean, error: string|null }} Validation result
 *
 * @example
 * const result = validate(event);
 * if (!result.valid) console.error(result.error);
 */
export function validate(event, now = Math.floor(Date.now() / 1000)) {
  if (event.kind !== KIND) {
    return { valid: false, error: `wrong kind: expected ${KIND}, got ${event.kind}` };
  }

  let content;
  try {
    content = JSON.parse(event.content);
  } catch {
    return { valid: false, error: 'content is not valid JSON' };
  }

  for (const field of ['subject', 'rating', 'context', 'confidence']) {
    if (!(field in content)) {
      return { valid: false, error: `missing required field: ${field}` };
    }
  }

  const tag = (name) => (event.tags || []).find(t => t[0] === name)?.[1];

  const p = tag('p');
  const t = tag('t');
  const d = tag('d');
  const exp = tag('expiration');

  if (!p) return { valid: false, error: 'missing p tag' };
  if (content.subject !== p) return { valid: false, error: 'subject does not match p tag' };
  if (!t) return { valid: false, error: 'missing t tag' };
  if (content.context !== t) return { valid: false, error: 'context does not match t tag' };
  if (d !== `${p}:${t}`) return { valid: false, error: 'd tag mismatch' };

  if (!Number.isInteger(content.rating) || content.rating < 1 || content.rating > 5) {
    return { valid: false, error: 'rating must be integer in [1, 5]' };
  }
  if (typeof content.confidence !== 'number' || content.confidence < 0 || content.confidence > 1) {
    return { valid: false, error: 'confidence must be number in [0, 1]' };
  }

  if (!exp || isNaN(parseInt(exp, 10))) {
    return { valid: false, error: 'missing expiration tag' };
  }

  if (event.pubkey === content.subject) {
    return { valid: false, error: 'self-attestation' };
  }

  if (now >= parseInt(exp, 10)) {
    return { valid: false, error: 'expired' };
  }

  return { valid: true, error: null };
}

// ============================================================================
// Decay Functions
// ============================================================================

const GAUSSIAN_SIGMA_FACTOR = 1 / Math.sqrt(2 * Math.LN2);

/**
 * Exponential temporal decay: 2^(-age/halfLife)
 * Long-tail — old attestations still contribute.
 *
 * @param {number} createdAt - Event creation timestamp
 * @param {number} now - Current timestamp
 * @param {number} [halfLife] - Half-life in seconds
 * @returns {number} Decay factor in [0, 1]
 */
export function exponentialDecay(createdAt, now, halfLife = DEFAULT_HALF_LIFE) {
  const age = now - createdAt;
  return age <= 0 ? 1.0 : Math.pow(2, -age / halfLife);
}

/**
 * Gaussian temporal decay: exp(-0.5 * (age/sigma)^2)
 * Aggressive drop-off — recent attestations dominate.
 *
 * At halfLife: 0.5 (same as exponential)
 * At 2×halfLife: ~0.063 (vs 0.25 exponential)
 * At 3×halfLife: ~0.003 (vs 0.125 exponential)
 *
 * @param {number} createdAt - Event creation timestamp
 * @param {number} now - Current timestamp
 * @param {number} [halfLife] - Half-life in seconds
 * @returns {number} Decay factor in [0, 1]
 */
export function gaussianDecay(createdAt, now, halfLife = DEFAULT_HALF_LIFE) {
  const age = now - createdAt;
  if (age <= 0) return 1.0;
  const sigma = halfLife * GAUSSIAN_SIGMA_FACTOR;
  return Math.exp(-0.5 * Math.pow(age / sigma, 2));
}

/**
 * Calculate temporal decay using the specified method.
 *
 * @param {number} createdAt - Event creation timestamp
 * @param {number} now - Current timestamp
 * @param {number} [halfLife] - Half-life in seconds
 * @param {'exponential'|'gaussian'} [type='exponential'] - Decay type
 * @returns {number} Decay factor in [0, 1]
 */
export function decay(createdAt, now, halfLife = DEFAULT_HALF_LIFE, type = 'exponential') {
  return type === 'gaussian'
    ? gaussianDecay(createdAt, now, halfLife)
    : exponentialDecay(createdAt, now, halfLife);
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse a validated Kind 30085 event into structured data.
 *
 * @param {Object} event - Nostr event (should be validated first)
 * @param {Object} [opts]
 * @param {number} [opts.now] - Reference timestamp
 * @param {'exponential'|'gaussian'} [opts.decayType='exponential'] - Decay type
 * @returns {Object} Parsed attestation
 *
 * @example
 * const a = parse(event);
 * console.log(a.rating, a.confidence, a.decay_factor);
 */
export function parse(event, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);
  const decayType = opts.decayType || 'exponential';

  const content = JSON.parse(event.content);
  const tag = (name) => (event.tags || []).find(t => t[0] === name)?.[1];

  const hlClass = tag('half_life_class');
  const halfLife = hlClass && HALF_LIFE_CLASSES[hlClass] ? HALF_LIFE_CLASSES[hlClass] : DEFAULT_HALF_LIFE;

  const commitmentClass = content.commitment_class || tag('commitment_class') || 'self_assertion';
  const commitmentWeight = COMMITMENT_CLASSES[commitmentClass] || 1.0;

  return {
    attestor: event.pubkey,
    subject: content.subject,
    context: content.context,
    rating: content.rating,
    confidence: content.confidence,
    evidence: content.evidence || null,
    commitment_class: commitmentClass,
    commitment_weight: commitmentWeight,
    half_life: halfLife,
    created_at: event.created_at,
    expiration: parseInt(tag('expiration'), 10),
    decay_factor: decay(event.created_at, now, halfLife, decayType),
  };
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Tier 1: Weighted average score with temporal decay.
 *
 * Score = Σ(rating × confidence × decay × commitment_weight) / Σ(confidence × decay × commitment_weight)
 *
 * @param {Array} attestations - Parsed attestation objects
 * @param {Object} [opts]
 * @param {number} [opts.now] - Reference timestamp
 * @param {number} [opts.halfLife] - Override half-life for all attestations
 * @param {'exponential'|'gaussian'} [opts.decayType='exponential'] - Decay type
 * @returns {number} Score in [1, 5], or 0 if no attestations
 *
 * @example
 * const attestations = events.filter(e => validate(e).valid).map(e => parse(e));
 * const score = tier1Score(attestations);
 */
export function tier1Score(attestations, opts = {}) {
  if (!attestations?.length) return 0;

  const now = opts.now || Math.floor(Date.now() / 1000);
  const decayType = opts.decayType || 'exponential';

  let weightedSum = 0, totalWeight = 0;

  for (const a of attestations) {
    const hl = opts.halfLife || a.half_life || DEFAULT_HALF_LIFE;
    const d = decay(a.created_at, now, hl, decayType);
    const cw = a.commitment_weight || COMMITMENT_CLASSES[a.commitment_class] || 1.0;
    const weight = (a.confidence || 1.0) * d * cw;
    weightedSum += a.rating * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Tier 2: Attestor diversity metrics (Sybil resistance).
 *
 * @param {string[]} pubkeys - Attestor pubkeys
 * @returns {{ entropy: number, herfindahl: number, uniqueCount: number }}
 *
 * @example
 * const diversity = tier2Diversity(attestations.map(a => a.attestor));
 * if (diversity.herfindahl > 0.5) console.warn('Low diversity — possible Sybil');
 */
export function tier2Diversity(pubkeys) {
  if (!pubkeys?.length) return { entropy: 0, herfindahl: 1, uniqueCount: 0 };

  const counts = {};
  for (const pk of pubkeys) counts[pk] = (counts[pk] || 0) + 1;

  const total = pubkeys.length;
  const uniqueCount = Object.keys(counts).length;

  let entropy = 0, herfindahl = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
    herfindahl += p * p;
  }

  return { entropy, herfindahl, uniqueCount };
}

/**
 * Detect burst attestation patterns (rate limiting).
 *
 * @param {Array} attestations - Objects with created_at timestamps
 * @param {number} [windowSeconds=3600] - Sliding window size
 * @param {number} [maxInWindow=10] - Max allowed in window
 * @returns {boolean} true if suspicious burst detected
 */
export function detectBurst(attestations, windowSeconds = 3600, maxInWindow = 10) {
  if (!attestations || attestations.length <= maxInWindow) return false;

  const sorted = [...attestations].sort((a, b) => a.created_at - b.created_at);
  for (let i = 0; i <= sorted.length - maxInWindow - 1; i++) {
    if (sorted[i + maxInWindow].created_at - sorted[i].created_at < windowSeconds) return true;
  }
  return false;
}

// ============================================================================
// Event Creation
// ============================================================================

/**
 * Create an unsigned Kind 30085 attestation event.
 * Sign with nostr-tools or NIP-07 before publishing.
 *
 * @param {Object} params
 * @param {string} params.attestor - Your pubkey (64-char hex)
 * @param {string} params.subject - Subject pubkey (64-char hex)
 * @param {string} params.context - Context namespace (e.g., "reliability")
 * @param {number} params.rating - Rating [1-5]
 * @param {number} params.confidence - Confidence [0-1]
 * @param {string} [params.commitment] - Commitment class name
 * @param {Array} [params.evidence] - Evidence array
 * @param {number} [params.expirationDays=180] - Days until expiry
 * @param {string} [params.halfLifeClass] - "slow", "standard", or "fast"
 * @returns {Object} Unsigned Nostr event
 *
 * @example
 * import { create } from 'nostr-reputation';
 * import { finalizeEvent } from 'nostr-tools/pure';
 *
 * const unsigned = create({
 *   attestor: myPubkey,
 *   subject: theirPubkey,
 *   context: 'reliability',
 *   rating: 4,
 *   confidence: 0.85,
 *   commitment: 'economic_settlement',
 * });
 * const signed = finalizeEvent(unsigned, mySecretKey);
 */
export function create({ attestor, subject, context, rating, confidence, commitment, evidence, expirationDays = 180, halfLifeClass }) {
  const now = Math.floor(Date.now() / 1000);

  const content = { subject, context, rating, confidence };
  if (commitment) content.commitment_class = commitment;
  if (evidence) content.evidence = evidence;

  const tags = [
    ['d', `${subject}:${context}`],
    ['p', subject],
    ['t', context],
    ['expiration', String(now + expirationDays * 86400)],
  ];

  if (halfLifeClass && HALF_LIFE_CLASSES[halfLifeClass]) tags.push(['half_life_class', halfLifeClass]);
  if (commitment) tags.push(['commitment_class', commitment]);

  return { kind: KIND, pubkey: attestor, created_at: now, content: JSON.stringify(content), tags };
}

// ============================================================================
// Convenience
// ============================================================================

/**
 * One-call scoring: validate → parse → score.
 *
 * @param {Array} events - Raw Kind 30085 events
 * @param {string} subject - Subject pubkey to score
 * @param {Object} [opts]
 * @param {string} [opts.context] - Filter by context namespace
 * @param {number} [opts.now] - Reference timestamp
 * @param {'exponential'|'gaussian'} [opts.decayType] - Decay type
 * @param {number} [opts.halfLife] - Override half-life
 * @returns {{ score: number, count: number, diversity: Object }}
 */
export function score(events, subject, opts = {}) {
  const now = opts.now || Math.floor(Date.now() / 1000);

  const attestations = events
    .filter(e => validate(e, now).valid)
    .map(e => parse(e, { now, decayType: opts.decayType }))
    .filter(a => a.subject === subject)
    .filter(a => !opts.context || a.context === opts.context || a.context.startsWith(opts.context + '.'));

  return {
    score: tier1Score(attestations, { now, decayType: opts.decayType, halfLife: opts.halfLife }),
    count: attestations.length,
    diversity: tier2Diversity(attestations.map(a => a.attestor)),
  };
}
