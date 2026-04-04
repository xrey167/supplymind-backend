export interface SkillRegisteredEvent {
  name: string;
  providerType: string;
}

export interface SkillInvokedEvent {
  name: string;
  durationMs: number;
  success: boolean;
}
