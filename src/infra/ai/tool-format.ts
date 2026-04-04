import type { ToolDefinition, ToolChoice } from './types';

export function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const tool: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    };
    if (t.strict !== undefined) tool.strict = t.strict;
    if (t.cacheControl) tool.cache_control = t.cacheControl;
    if (t.eagerInputStreaming !== undefined) tool.eager_input_streaming = t.eagerInputStreaming;
    return tool;
  });
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const fn: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    };
    if (t.strict !== undefined) fn.strict = t.strict;
    return { type: 'function' as const, function: fn };
  });
}

export function toGoogleTools(tools: ToolDefinition[]) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

/** Convert our ToolChoice to Anthropic's tool_choice format */
export function toAnthropicToolChoice(choice: ToolChoice): Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return { type: 'auto' };
    case 'any': return { type: 'any' };
    case 'tool': return { type: 'tool', name: choice.name };
    case 'none': return { type: 'auto' }; // Anthropic has no 'none' — pass empty tools instead
  }
}

/** Convert our ToolChoice to OpenAI's tool_choice format */
export function toOpenAIToolChoice(choice: ToolChoice): string | Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'tool': return { type: 'function', function: { name: choice.name } };
    case 'none': return 'none';
  }
}

/** Convert our ToolChoice to Google's toolConfig format */
export function toGoogleToolConfig(choice: ToolChoice): Record<string, unknown> {
  switch (choice.type) {
    case 'auto': return { functionCallingConfig: { mode: 'AUTO' } };
    case 'any': return { functionCallingConfig: { mode: 'ANY' } };
    case 'tool': return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
    case 'none': return { functionCallingConfig: { mode: 'NONE' } };
  }
}
