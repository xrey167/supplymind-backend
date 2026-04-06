export interface ToolOptions {
  /** Max execution time in ms */
  timeout?: number;
  /** Number of retries on transient failure */
  retries?: number;
  /** Whether to defer loading this tool until first use */
  deferLoading?: boolean;
  /** Whether to cache the tool's result for identical inputs */
  cacheable?: boolean;
}

export const TOOL_DEFAULTS: Readonly<Required<ToolOptions>> = Object.freeze({
  timeout: 30_000,
  retries: 2,
  deferLoading: false,
  cacheable: false,
});

export interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput) => Promise<TOutput>;
  options: Required<ToolOptions>;
}

export interface BuildToolInput<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: TInput) => Promise<TOutput>;
  options?: Partial<ToolOptions>;
}

export function buildTool<TInput, TOutput>(
  config: BuildToolInput<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute,
    options: { ...TOOL_DEFAULTS, ...config.options },
  };
}
