# nostr-reputation

Kind 30085 agent reputation attestations for Nostr. Create, validate, score, and analyze trust — zero dependencies.

Implements the [NIP-XX spec](https://github.com/nostr-protocol/nips/pull/2320) for decentralized agent reputation.

## Install

```bash
npm install nostr-reputation
```

## Quick Start

```js
import { create, validate, parse, score } from 'nostr-reputation';
import { finalizeEvent } from 'nostr-tools/pure';

// Create an attestation
const unsigned = create({
  attestor: myPubkey,
  subject: theirPubkey,
  context: 'reliability',
  rating: 4,
  confidence: 0.85,
  commitment: 'economic_settlement',
});

// Sign and publish
const signed = finalizeEvent(unsigned, mySecretKey);
await relay.publish(signed);
```

## Score a Subject

```js
import { score } from 'nostr-reputation';

// Fetch Kind 30085 events for a subject, then:
const result = score(events, subjectPubkey);

console.log(result.score);              // 1-5 weighted average
console.log(result.count);              // number of valid attestations
console.log(result.diversity);          // { entropy, herfindahl, uniqueCount }
```

## API

### `validate(event, now?)`
Checks all 10 NIP-XX rules. Returns `{ valid, error }`.

### `create({ attestor, subject, context, rating, confidence, commitment?, evidence?, expirationDays?, halfLifeClass? })`
Creates an unsigned Kind 30085 event. Sign with nostr-tools before publishing.

### `parse(event, opts?)`
Parses a validated event into structured data with computed decay factor.

### `score(events, subject, opts?)`
One-call: validate → parse → score. Returns `{ score, count, diversity }`.

### `tier1Score(attestations, opts?)`
Weighted average with temporal decay and commitment class weights.

### `tier2Diversity(pubkeys)`
Sybil resistance metrics: Shannon entropy + Herfindahl concentration index.

### `detectBurst(attestations, windowSeconds?, maxInWindow?)`
Rate-limit check for suspicious attestation bursts.

### Decay Functions

Two temporal decay models:

- **`exponentialDecay`** — Long-tail: old attestations still contribute
- **`gaussianDecay`** — Aggressive drop-off: recent attestations dominate

Both produce 0.5 at the half-life point. Gaussian drops to ~0.06 at 2× half-life vs 0.25 for exponential.

```js
import { decay } from 'nostr-reputation';

decay(createdAt, now, halfLife, 'exponential'); // default
decay(createdAt, now, halfLife, 'gaussian');    // for fast-moving contexts
```

## Commitment Classes

Attestations carry different weight based on [Grafen/Zahavi signaling theory](https://en.wikipedia.org/wiki/Handicap_principle):

| Class | Weight | Meaning |
|-------|--------|---------|
| `self_assertion` | 1.0 | Cheap talk |
| `social_endorsement` | 1.05 | Staking social capital |
| `computational_proof` | 1.1 | Proof of work/compute |
| `time_lock` | 1.15 | Time-locked commitment |
| `economic_settlement` | 1.25 | Lightning payment proof |

## Spec

- Kind: `30085` (addressable, replaceable per subject:context pair)
- NIP PR: [nostr-protocol/nips#2320](https://github.com/nostr-protocol/nips/pull/2320)
- Python implementation: [nip-xx-python](https://github.com/kai-familiar/nip-xx-python)
- Web playground: [kai-familiar.github.io/reputation.html](https://kai-familiar.github.io/reputation.html)

## License

MIT
