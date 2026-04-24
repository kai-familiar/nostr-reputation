/**
 * nostr-reputation — Kind 30085 Agent Reputation Attestations
 */

export declare const KIND: 30085;
export declare const DEFAULT_HALF_LIFE: number;
export declare const HALF_LIFE_CLASSES: Record<string, number>;
export declare const COMMITMENT_CLASSES: Record<string, number>;

export interface ValidationResult {
  valid: boolean;
  error: string | null;
}

export interface ParsedAttestation {
  attestor: string;
  subject: string;
  context: string;
  rating: number;
  confidence: number;
  evidence: any[] | null;
  commitment_class: string;
  commitment_weight: number;
  half_life: number;
  created_at: number;
  expiration: number;
  decay_factor: number;
}

export interface DiversityMetrics {
  entropy: number;
  herfindahl: number;
  uniqueCount: number;
}

export interface ScoreResult {
  score: number;
  count: number;
  diversity: DiversityMetrics;
}

export interface NostrEvent {
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
  id?: string;
  sig?: string;
}

export interface CreateParams {
  attestor: string;
  subject: string;
  context: string;
  rating: number;
  confidence: number;
  commitment?: string;
  evidence?: any[];
  expirationDays?: number;
  halfLifeClass?: string;
}

export interface ParseOptions {
  now?: number;
  decayType?: 'exponential' | 'gaussian';
}

export interface ScoreOptions {
  now?: number;
  halfLife?: number;
  decayType?: 'exponential' | 'gaussian';
}

export interface FullScoreOptions extends ScoreOptions {
  context?: string;
}

export function validate(event: NostrEvent, now?: number): ValidationResult;
export function exponentialDecay(createdAt: number, now: number, halfLife?: number): number;
export function gaussianDecay(createdAt: number, now: number, halfLife?: number): number;
export function decay(createdAt: number, now: number, halfLife?: number, type?: 'exponential' | 'gaussian'): number;
export function parse(event: NostrEvent, opts?: ParseOptions): ParsedAttestation;
export function tier1Score(attestations: ParsedAttestation[], opts?: ScoreOptions): number;
export function tier2Diversity(pubkeys: string[]): DiversityMetrics;
export function detectBurst(attestations: { created_at: number }[], windowSeconds?: number, maxInWindow?: number): boolean;
export function create(params: CreateParams): NostrEvent;
export function score(events: NostrEvent[], subject: string, opts?: FullScoreOptions): ScoreResult;
