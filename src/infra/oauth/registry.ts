import type { OAuthProvider } from './types';
import { claudeProvider } from './providers/claude';
import { googleProvider } from './providers/google';
import { openaiProvider } from './providers/openai';
import { githubProvider } from './providers/github';
import { codexProvider } from './providers/codex';
import { kiroProvider } from './providers/kiro';
import { clineProvider } from './providers/cline';
import { cursorProvider } from './providers/cursor';
import { kimiCodingProvider } from './providers/kimi-coding';
import { antigravityProvider } from './providers/antigravity';
import { kilocodeProvider } from './providers/kilocode';

class OAuthProviderRegistry {
  private providers = new Map<string, OAuthProvider>([
    ['claude', claudeProvider],
    ['google', googleProvider],
    ['openai', openaiProvider],
    ['github', githubProvider],
    ['codex', codexProvider],
    ['kiro', kiroProvider],
    ['cline', clineProvider],
    ['cursor', cursorProvider],
    ['kimi-coding', kimiCodingProvider],
    ['antigravity', antigravityProvider],
    ['kilocode', kilocodeProvider],
  ]);

  register(provider: OAuthProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): OAuthProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown OAuth provider: ${id}`);
    return provider;
  }

  list(): OAuthProvider[] {
    return Array.from(this.providers.values());
  }
}

export const oauthProviderRegistry = new OAuthProviderRegistry();

/** @deprecated Use oauthProviderRegistry.get() */
export function getProvider(id: string): OAuthProvider {
  return oauthProviderRegistry.get(id);
}

/** @deprecated Use oauthProviderRegistry.list() */
export function listProviders(): OAuthProvider[] {
  return oauthProviderRegistry.list();
}
