/**
 * Validates workspace-provided config against a plugin's configSchema (JSON Schema subset).
 * Only validates: required fields and basic type checks (string, number, boolean, object, array).
 */
export function validatePluginConfig(
  config: Record<string, unknown>,
  configSchema: Record<string, unknown> | undefined,
): { valid: true } | { valid: false; error: string } {
  if (!configSchema) return { valid: true };

  const properties = (configSchema as any).properties as Record<string, { type: string }> | undefined;
  const required = (configSchema as any).required as string[] | undefined;

  if (required) {
    for (const key of required) {
      if (!(key in config)) {
        return { valid: false, error: `Missing required config field: ${key}` };
      }
    }
  }

  if (properties) {
    for (const [key, def] of Object.entries(properties)) {
      if (key in config && def.type) {
        const actual = typeof config[key];
        const expected = def.type === 'array' ? 'object' : def.type;
        if (actual !== expected && !(def.type === 'array' && Array.isArray(config[key]))) {
          return { valid: false, error: `Config field '${key}': expected ${def.type}, got ${actual}` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Checks that the caller has all permissions required by the plugin.
 */
export function checkPermissions(
  callerPermissions: string[],
  requiredPermissions: string[],
): { allowed: true } | { allowed: false; missing: string[] } {
  const missing = requiredPermissions.filter(p => !callerPermissions.includes(p));
  return missing.length === 0
    ? { allowed: true }
    : { allowed: false, missing };
}
