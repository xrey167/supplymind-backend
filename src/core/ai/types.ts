/** Tier that determines which model class to use for a given intent */
export enum IntentTier {
  FAST     = 'fast',
  BALANCED = 'balanced',
  POWERFUL = 'powerful',
}

/** Policy interface — infra layer implements this, core defines the contract */
export interface ModelRoutingPolicy {
  classify(prompt: string): IntentTier;
  route(tier: IntentTier, overrides?: Record<string, string | undefined>): string;
}
