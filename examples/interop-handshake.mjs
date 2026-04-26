#!/usr/bin/env node
/**
 * interop-handshake.mjs — Cross-protocol trust exchange demo
 * 
 * Shows how to bridge Kind 30085 attestations with W3C Verifiable Credentials,
 * enabling trust exchange between Nostr-native agents and VC-based systems
 * (HiveTrust, APS, DID-based frameworks).
 * 
 * Run: node examples/interop-handshake.mjs
 */

import { create, validate, parse, tier1Score, decay } from '../index.js';

// --- Commitment class ↔ W3C VC evidence mapping ---

const COMMITMENT_TO_VC = {
  social_post:          { type: 'SocialSignal',        strength: 'low' },
  social_endorsement:   { type: 'SocialSignal',        strength: 'low' },
  cross_platform:       { type: 'CrossPlatformSignal', strength: 'medium' },
  economic_settlement:  { type: 'PaymentReceipt',      strength: 'high' },
  on_chain:             { type: 'BlockchainAnchor',    strength: 'maximum' },
};

const VC_TO_COMMITMENT = Object.fromEntries(
  Object.entries(COMMITMENT_TO_VC).map(([k, v]) => [v.type, k])
);

// --- Convert Kind 30085 → W3C VC ---

function attestationToVC(event) {
  const parsed = parse(event);
  const vcEvidence = COMMITMENT_TO_VC[parsed.commitment_class] || COMMITMENT_TO_VC.social_post;
  
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential', 'AgentReputationAttestation'],
    issuer: `did:nostr:${event.pubkey}`,
    issuanceDate: new Date(event.created_at * 1000).toISOString(),
    credentialSubject: {
      id: `did:nostr:${parsed.subject}`,
      reputation: {
        rating: parsed.rating,
        scale: 5,
        confidence: parsed.confidence,
        context: parsed.context,
      },
    },
    evidence: [{
      type: vcEvidence.type,
      strength: vcEvidence.strength,
      description: event.content,
      nostrEventId: event.id,
      commitmentClass: parsed.commitment_class,
    }],
    proof: {
      type: 'SchnorrSignature2024',
      created: new Date(event.created_at * 1000).toISOString(),
      verificationMethod: `did:nostr:${event.pubkey}#key-0`,
      proofValue: event.sig,
    },
  };
}

// --- Convert W3C VC → Kind 30085 template ---

function vcToAttestationTemplate(vc) {
  const subjectId = vc.credentialSubject?.id || '';
  const targetHex = subjectId.replace('did:nostr:', '');
  const rep = vc.credentialSubject?.reputation || {};
  const evidence = vc.evidence?.[0] || {};
  
  return {
    subject: targetHex,
    rating: rep.rating || 3,
    scale: rep.scale || 5,
    confidence: rep.confidence || 0.5,
    context: rep.context || 'general',
    commitment: evidence.commitmentClass || VC_TO_COMMITMENT[evidence.type] || 'social_endorsement',
    content: evidence.description || '',
  };
}

// --- Demo ---

console.log('🤝 Cross-Protocol Trust Handshake Demo');
console.log('═'.repeat(50));

// Step 1: Create attestations from two agents
const agentA = 'a'.repeat(64);
const agentB = 'b'.repeat(64);
const now = Math.floor(Date.now() / 1000);

console.log('\n📝 Step 1: Agent A creates Kind 30085 attestation for Agent B');

const attestationTemplate = create({
  attestor: agentA,
  subject: agentB,
  rating: 5,
  confidence: 0.9,
  context: 'interop.handshake',
  commitment: 'economic_settlement',
  evidence: 'Successfully completed L402 payment exchange — 500 sats',
});

// In production, you'd sign with finalizeEvent(). For demo, add mock fields.
const attestation = { ...attestationTemplate, id: '1'.repeat(64), sig: 'f'.repeat(128) };

const validation = validate(attestation);
console.log(`   Valid: ${validation.valid ? '✅' : '❌'} (${validation.error || "none"} )`);
console.log(`   Rating: ⭐⭐⭐⭐⭐ (5/5)`);
console.log(`   Commitment: economic_settlement (high cost signal)`);

// Step 2: Convert to W3C VC
console.log('\n🔄 Step 2: Convert to W3C Verifiable Credential');
const vc = attestationToVC(attestation);
console.log(`   Issuer:  ${vc.issuer}`);
console.log(`   Subject: ${vc.credentialSubject.id}`);
console.log(`   Evidence: ${vc.evidence[0].type} (${vc.evidence[0].strength})`);
console.log(`   Proof:   ${vc.proof.type}`);

// Step 3: Simulate receiving VC and converting back
console.log('\n📥 Step 3: Agent B receives VC and converts back to Kind 30085');
const template = vcToAttestationTemplate(vc);
console.log(`   Target:     ${template.subject.slice(0, 16)}...`);
console.log(`   Rating:     ${template.rating}/${template.scale}`);
console.log(`   Commitment: ${template.commitment}`);
console.log(`   Context:    ${template.context}`);

// Step 4: Agent B creates reciprocal attestation
console.log('\n🔁 Step 4: Agent B creates reciprocal attestation');
const reciprocalTemplate = create({
  attestor: agentB,
  subject: agentA,
  rating: 4,
  confidence: 0.85,
  context: 'interop.handshake',
  commitment: 'economic_settlement',
  evidence: 'Reciprocal handshake — verified via W3C VC exchange',
});
const reciprocal = { ...reciprocalTemplate, id: '2'.repeat(64), sig: 'e'.repeat(128) };

const reciprocalValid = validate(reciprocal);
console.log(`   Valid: ${reciprocalValid.valid ? '✅' : '❌'}`);
console.log(`   Rating: ⭐⭐⭐⭐ (4/5)`);

// Step 5: Score the mutual relationship
console.log('\n📊 Step 5: Score mutual trust relationship');

const aScoreFromB = tier1Score([parse(reciprocal)], { decayType: 'exponential' });
const bScoreFromA = tier1Score([parse(attestation)], { decayType: 'exponential' });

console.log(`   Agent A's reputation (from B): ${bScoreFromA.toFixed(3)}`);
console.log(`   Agent B's reputation (from A): ${aScoreFromB.toFixed(3)}`);
console.log(`   Mutual trust: ✅ ESTABLISHED`);

// Step 6: Show the mapping table
console.log('\n📋 Commitment Class ↔ VC Evidence Mapping:');
console.log('   ┌─────────────────────┬──────────────────────┬──────────┐');
console.log('   │ Kind 30085          │ W3C VC Evidence      │ Strength │');
console.log('   ├─────────────────────┼──────────────────────┼──────────┤');
for (const [k, v] of Object.entries(COMMITMENT_TO_VC)) {
  console.log(`   │ ${k.padEnd(19)} │ ${v.type.padEnd(20)} │ ${v.strength.padEnd(8)} │`);
}
console.log('   └─────────────────────┴──────────────────────┴──────────┘');

console.log('\n✅ Handshake complete — both protocols can exchange trust data');
console.log('   See: https://github.com/nostr-protocol/nips/pull/2320\n');
