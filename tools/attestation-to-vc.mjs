#!/usr/bin/env node
/**
 * attestation-to-vc.mjs — Bridge Kind 30085 attestations ↔ W3C Verifiable Credentials
 * 
 * Converts between NIP-XX Kind 30085 (Nostr relay-based) and W3C VC format
 * (used by HiveTrust, APS, and other standards-based systems).
 * 
 * This proves that the commitment-class mapping between systems works in practice.
 * 
 * Usage:
 *   node tools/attestation-to-vc.mjs <npub|hex>           # Fetch attestations → output as VCs
 *   node tools/attestation-to-vc.mjs --demo                # Run with sample data
 *   node tools/attestation-to-vc.mjs --from-vc <vc.json>   # Convert VC → Kind 30085 event
 *   node tools/attestation-to-vc.mjs --json <npub|hex>     # JSON output
 * 
 * Author: Kai (kai-familiar)
 * License: MIT
 * Added: Day 84 (2026-04-25)
 */

import { createAttestation, validateEvent, parseAttestation, tier1Score } from './nip-xx-kind30085.mjs';

// --- Commitment class mapping (Kind 30085 ↔ W3C VC) ---

const COMMITMENT_TO_VC_EVIDENCE = {
  social_post:          { type: 'SocialSignal',         strength: 'low',    description: 'Social media attestation' },
  cross_platform:       { type: 'CrossPlatformSignal',  strength: 'medium', description: 'Multi-platform verification' },
  economic_settlement:  { type: 'PaymentReceipt',       strength: 'high',   description: 'Economic settlement via L402/x402' },
  on_chain:             { type: 'BlockchainAnchor',     strength: 'maximum', description: 'On-chain transaction proof' },
};

const VC_EVIDENCE_TO_COMMITMENT = {
  'SocialSignal':        'social_post',
  'CrossPlatformSignal': 'cross_platform',
  'PaymentReceipt':      'economic_settlement',
  'BlockchainAnchor':    'on_chain',
};

// --- Kind 30085 → W3C VC ---

function getTag(event, name) {
  return event.tags?.find(t => t[0] === name)?.[1];
}

function attestationToVC(event) {
  const subject = getTag(event, 'p') || getTag(event, 'd');
  if (!subject) return null;

  const rating = parseInt(getTag(event, 'rating') || '3');
  const confidence = parseFloat(getTag(event, 'confidence') || '0.5');
  const context = getTag(event, 'context') || 'general';
  const commitment = getTag(event, 'commitment') || 'social_post';
  const evidence = getTag(event, 'evidence') || '';

  const commitmentInfo = COMMITMENT_TO_VC_EVIDENCE[commitment] || COMMITMENT_TO_VC_EVIDENCE.social_post;

  // Map expiry tag to VC expirationDate
  const expiryVal = getTag(event, 'expiry');
  const expirationDate = expiryVal
    ? new Date(parseInt(expiryVal) * 1000).toISOString()
    : new Date((event.created_at + 365 * 86400) * 1000).toISOString(); // default 1 year

  // Build W3C VC
  const vc = {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    type: ['VerifiableCredential', 'ReputationAttestation'],
    issuer: {
      id: `did:nostr:${event.pubkey}`,
      type: 'NostrIdentity',
    },
    issuanceDate: new Date(event.created_at * 1000).toISOString(),
    expirationDate,
    credentialSubject: {
      id: `did:nostr:${subject}`,
      type: 'AgentReputationScore',
      rating,
      confidence,
      context,
      evidence,
    },
    credentialEvidence: {
      type: commitmentInfo.type,
      strength: commitmentInfo.strength,
      description: commitmentInfo.description,
      commitment,
      nostrEventId: event.id,
      nostrRelay: 'wss://relay.damus.io',
    },
    proof: {
      type: 'NostrEventSignature',
      created: new Date(event.created_at * 1000).toISOString(),
      verificationMethod: `did:nostr:${event.pubkey}#nostr-key`,
      proofValue: event.sig,
      nostrEventId: event.id,
    },
  };

  return vc;
}

// --- W3C VC → Kind 30085 event template ---

function vcToAttestationTemplate(vc) {
  const subject = vc.credentialSubject;
  if (!subject?.id) return null;

  // Extract hex pubkey from did:nostr:
  const subjectPubkey = subject.id.replace('did:nostr:', '');

  // Map evidence type to commitment class
  const evidenceType = vc.credentialEvidence?.type || 'SocialSignal';
  const commitment = VC_EVIDENCE_TO_COMMITMENT[evidenceType] || 'social_post';
  const rating = subject.rating || 3;
  const confidence = subject.confidence || 0.5;
  const context = subject.context || 'general';
  const evidence = subject.evidence || `Converted from W3C VC issued ${vc.issuanceDate}`;
  const now = Math.floor(Date.now() / 1000);

  // Build event template directly (more reliable than createAttestation for bridge use)
  return {
    kind: 30085,
    created_at: now,
    content: JSON.stringify({ context, rating, confidence, evidence }),
    tags: [
      ['d', `${subjectPubkey}:${context}`],
      ['p', subjectPubkey],
      ['rating', String(rating)],
      ['confidence', String(confidence)],
      ['context', context],
      ['commitment', commitment],
      ['evidence', evidence],
      ['expiry', String(now + 180 * 86400)],
      ['L', 'social.reputation'],
      ['l', 'attestation', 'social.reputation'],
    ],
  };
}

// --- Demo ---

function runDemo() {
  console.log('=== Kind 30085 → W3C Verifiable Credential Bridge ===\n');

  // Create a sample attestation
  const sampleEvent = {
    id: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    pubkey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    created_at: Math.floor(Date.now() / 1000),
    kind: 30085,
    tags: [
      ['d', 'feedfeedfeeddead1234567890abcdef1234567890abcdef1234567890abcdef'],
      ['p', 'feedfeedfeeddead1234567890abcdef1234567890abcdef1234567890abcdef'],
      ['rating', '4'],
      ['confidence', '0.8'],
      ['context', 'reliability'],
      ['commitment', 'economic_settlement'],
      ['evidence', 'Completed L402 payment for API access, service delivered correctly'],
      ['expiry', String(Math.floor(Date.now() / 1000) + 180 * 86400)],
      ['L', 'social.reputation'],
      ['l', 'attestation', 'social.reputation'],
    ],
    content: '{}',
    sig: 'deadbeef'.repeat(16),
  };

  console.log('1. Sample Kind 30085 attestation:');
  const subj = getTag(sampleEvent, 'p');
  const rat = parseInt(getTag(sampleEvent, 'rating'));
  const conf = parseFloat(getTag(sampleEvent, 'confidence'));
  const ctx = getTag(sampleEvent, 'context');
  const comm = getTag(sampleEvent, 'commitment');
  const evid = getTag(sampleEvent, 'evidence');
  console.log(`   Subject: ${subj.slice(0, 16)}...`);
  console.log(`   Rating: ${'★'.repeat(rat)}${'☆'.repeat(5 - rat)} (${rat}/5)`);
  console.log(`   Confidence: ${(conf * 100).toFixed(0)}%`);
  console.log(`   Context: ${ctx}`);
  console.log(`   Commitment: ${comm}`);
  console.log(`   Evidence: ${evid}`);

  console.log('\n2. Converted to W3C Verifiable Credential:');
  const vc = attestationToVC(sampleEvent);
  console.log(JSON.stringify(vc, null, 2));

  console.log('\n3. Round-trip: VC → Kind 30085 template:');
  const roundTrip = vcToAttestationTemplate(vc);
  console.log('   Tags:');
  for (const tag of roundTrip.tags) {
    console.log(`     ${JSON.stringify(tag)}`);
  }

  console.log('\n4. Commitment class mapping:');
  console.log('   ┌─────────────────────┬─────────────────────┬──────────┐');
  console.log('   │ Kind 30085          │ W3C VC Evidence     │ Strength │');
  console.log('   ├─────────────────────┼─────────────────────┼──────────┤');
  for (const [k, v] of Object.entries(COMMITMENT_TO_VC_EVIDENCE)) {
    console.log(`   │ ${k.padEnd(19)} │ ${v.type.padEnd(19)} │ ${v.strength.padEnd(8)} │`);
  }
  console.log('   └─────────────────────┴─────────────────────┴──────────┘');

  console.log('\n✅ Bridge works. Attestations can flow between Nostr relays and W3C VC systems.');
  console.log('   The commitment-class mapping preserves signal strength across formats.');
}

// --- Relay fetch (if npub provided) ---

async function fetchAndConvert(pubkeyOrNpub, jsonMode) {
  // Lazy import nostr-tools for relay access
  let nip19, SimplePool;
  try {
    ({ nip19 } = await import('nostr-tools'));
    ({ SimplePool } = await import('nostr-tools/pool'));
  } catch {
    console.error('nostr-tools required for relay fetching. Run: npm install nostr-tools');
    process.exit(1);
  }

  let hex = pubkeyOrNpub;
  if (pubkeyOrNpub.startsWith('npub')) {
    const decoded = nip19.decode(pubkeyOrNpub);
    hex = decoded.data;
  }

  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
  const pool = new SimplePool();

  console.log(`Fetching Kind 30085 attestations for ${hex.slice(0, 16)}...`);

  const events = await pool.querySync(relays, {
    kinds: [30085],
    '#p': [hex],
  });

  pool.close(relays);

  if (events.length === 0) {
    console.log('No attestations found.');
    return;
  }

  console.log(`Found ${events.length} attestation(s). Converting to W3C VCs:\n`);

  const vcs = [];
  for (const event of events) {
    const vc = attestationToVC(event);
    if (vc) {
      vcs.push(vc);
      if (!jsonMode) {
        const parsed = parseAttestation(event);
        console.log(`  Attestor: ${event.pubkey.slice(0, 12)}...`);
        console.log(`  Rating: ${'★'.repeat(parsed.rating)}${'☆'.repeat(5 - parsed.rating)}  Commitment: ${parsed.commitment}`);
        console.log(`  → VC Evidence: ${vc.credentialEvidence.type} (${vc.credentialEvidence.strength})`);
        console.log('');
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(vcs, null, 2));
  } else {
    console.log(`Converted ${vcs.length} attestation(s) to W3C VCs.`);
  }
}

// --- CLI ---

const args = process.argv.slice(2);

if (args.includes('--demo') || args.length === 0) {
  runDemo();
} else if (args.includes('--from-vc')) {
  const vcPath = args[args.indexOf('--from-vc') + 1];
  if (!vcPath) {
    console.error('Usage: --from-vc <path-to-vc.json>');
    process.exit(1);
  }
  const fs = await import('fs');
  const vc = JSON.parse(fs.readFileSync(vcPath, 'utf-8'));
  const template = vcToAttestationTemplate(vc);
  console.log(JSON.stringify(template, null, 2));
} else {
  const jsonMode = args.includes('--json');
  const pubkey = args.find(a => !a.startsWith('--'));
  if (pubkey) {
    await fetchAndConvert(pubkey, jsonMode);
  } else {
    runDemo();
  }
}
