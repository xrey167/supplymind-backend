import { describe, test, expect } from 'bun:test';
import { ToolError } from '../types';

describe('ToolError', () => {
  test('formats message with tool name', () => {
    const err = new ToolError('echo', 'connection failed');
    expect(err.message).toBe('Tool "echo" failed: connection failed');
    expect(err.toolName).toBe('echo');
    expect(err.name).toBe('ToolError');
  });

  test('includes optional error code', () => {
    const err = new ToolError('echo', 'not found', '404');
    expect(err.code).toBe('404');
  });

  test('is an instance of Error', () => {
    const err = new ToolError('test', 'msg');
    expect(err).toBeInstanceOf(Error);
  });
});
