export class AppError extends Error {
  constructor(public message: string, public statusCode: number = 500, public code?: string) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') { super(message, 404, 'NOT_FOUND'); }
}
export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') { super(message, 401, 'UNAUTHORIZED'); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super(message, 403, 'FORBIDDEN'); }
}
export class ValidationError extends AppError {
  constructor(message = 'Validation failed') { super(message, 422, 'VALIDATION_ERROR'); }
}

export type AIErrorClassification =
  | 'rate_limit'
  | 'overloaded'
  | 'auth_error'
  | 'prompt_too_long'
  | 'model_unavailable'
  | 'network'
  | 'timeout';

export class AIError extends AppError {
  constructor(
    message: string,
    public readonly classification: AIErrorClassification,
    public readonly retryAfterMs?: number,
    statusCode_: number = 500,
  ) {
    super(message, statusCode_, 'AI_' + classification.toUpperCase());
  }
}

export type AbortSource = 'user' | 'system' | 'timeout';

export class AbortError extends Error {
  readonly name = 'AbortError';
  constructor(message: string, public readonly source: AbortSource) {
    super(message);
  }
}

export type ToolRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export class ToolExecutionError extends AppError {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly riskLevel: ToolRiskLevel = 'LOW',
  ) {
    super(message, 500, 'TOOL_EXECUTION_ERROR');
  }
}

export function classifyAIError(error: unknown): AIError {
  if (error instanceof AIError) return error;

  const status = (error as any)?.status ?? (error as any)?.statusCode ?? 0;
  const rawMsg = error instanceof Error
    ? error.message
    : (typeof (error as any)?.message === 'string' ? (error as any).message : String(error));
  const msg = rawMsg.toLowerCase();
  const retryHeader = (error as any)?.headers?.['retry-after'];
  const parsedRetry = retryHeader ? parseInt(retryHeader, 10) : NaN;
  const retryAfterMs = !isNaN(parsedRetry) ? parsedRetry * 1000 : undefined;

  let classification: AIErrorClassification;

  if (status === 429 || msg.includes('rate limit') || msg.includes('rate_limit')) {
    classification = 'rate_limit';
  } else if (status === 529 || msg.includes('overload')) {
    classification = 'overloaded';
  } else if (status === 401 || status === 403 || msg.includes('api key') || msg.includes('authentication')) {
    classification = 'auth_error';
  } else if (status === 400 && (msg.includes('too long') || msg.includes('context length'))) {
    classification = 'prompt_too_long';
  } else if (status === 404 || msg.includes('model not found') || msg.includes('model_not_found')) {
    classification = 'model_unavailable';
  } else if (status === 408 || msg.includes('timeout') || msg.includes('timed out')) {
    classification = 'timeout';
  } else {
    classification = 'network';
  }

  return new AIError(rawMsg || 'Unknown AI error', classification, retryAfterMs, status || 500);
}
