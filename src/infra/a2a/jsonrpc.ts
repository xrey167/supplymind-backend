import type { JsonRpcRequest, JsonRpcResponse } from './types';

export type MethodHandler = (params: unknown) => Promise<unknown>;

export class JsonRpcDispatcher {
  private methods = new Map<string, MethodHandler>();

  register(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler);
  }

  async dispatch(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.methods.get(request.method);
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
    }
    try {
      const result = await handler(request.params);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message },
      };
    }
  }
}
