import type { OAuthProvider } from './types';
import { claudeProvider } from './providers/claude';
import { googleProvider } from './providers/google';
import { openaiProvider } from './providers/openai';
import { githubProvider } from './providers/github';

const PROVIDERS = new Map<string, OAuthProvider>([
  ['claude', claudeProvider],
  ['google', googleProvider],
  ['openai', openaiProvider],
  ['github', githubProvider],
]);

export function getProvider(id: string): OAuthProvider {
  const provider = PROVIDERS.get(id);
  if (!provider) throw new Error(`Unknown OAuth provider: ${id}`);
  return provider;
}

export function listProviders(): OAuthProvider[] {
  return Array.from(PROVIDERS.values());
}
