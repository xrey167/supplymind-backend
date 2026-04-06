import { describe, it, expect } from 'bun:test';
import { parseCommands } from '../shell-parse';

describe('parseCommands — splitting', () => {
  it('returns single command with no separators', () => {
    const result = parseCommands('ls -la');
    expect(result).toHaveLength(1);
    expect(result[0].raw).toBe('ls -la');
  });

  it('splits on semicolon', () => {
    const result = parseCommands('echo a; echo b');
    expect(result).toHaveLength(2);
    expect(result[0].raw).toBe('echo a');
    expect(result[1].raw).toBe('echo b');
  });

  it('splits on &&', () => {
    const result = parseCommands('echo a && echo b');
    expect(result).toHaveLength(2);
    expect(result[0].raw).toBe('echo a');
    expect(result[1].raw).toBe('echo b');
  });

  it('splits on ||', () => {
    const result = parseCommands('cmd1 || cmd2');
    expect(result).toHaveLength(2);
  });

  it('splits on pipe |', () => {
    const result = parseCommands('echo hello | grep hello');
    expect(result).toHaveLength(2);
    expect(result[0].raw).toBe('echo hello');
    expect(result[1].raw).toBe('grep hello');
  });

  it('does NOT split on semicolon inside single quotes', () => {
    const result = parseCommands("echo 'a; b'");
    expect(result).toHaveLength(1);
  });

  it('does NOT split on semicolon inside double quotes', () => {
    const result = parseCommands('echo "a; b"');
    expect(result).toHaveLength(1);
  });

  it('does NOT split on | inside quotes', () => {
    const result = parseCommands("echo 'a | b'");
    expect(result).toHaveLength(1);
  });

  it('handles multiple separators in sequence', () => {
    const result = parseCommands('a; b && c || d');
    expect(result).toHaveLength(4);
  });

  it('returns empty array for empty string', () => {
    expect(parseCommands('')).toHaveLength(0);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(parseCommands('   ')).toHaveLength(0);
  });

  it('trims whitespace from sub-commands', () => {
    const result = parseCommands('  ls  ;  pwd  ');
    expect(result[0].raw).toBe('ls');
    expect(result[1].raw).toBe('pwd');
  });
});

describe('parseCommands — token parsing', () => {
  it('extracts cmd as first token', () => {
    const [cmd] = parseCommands('ls -la /tmp');
    expect(cmd.cmd).toBe('ls');
  });

  it('extracts flags (tokens starting with -)', () => {
    const [cmd] = parseCommands('rm -rf /tmp');
    expect(cmd.flags).toContain('-rf');
  });

  it('extracts args (non-flag tokens)', () => {
    const [cmd] = parseCommands('rm -rf /tmp');
    expect(cmd.args).toContain('/tmp');
  });

  it('strips sudo prefix from cmd', () => {
    const [cmd] = parseCommands('sudo rm -rf /tmp');
    expect(cmd.cmd).toBe('rm');
  });

  it('detects subshell with $()', () => {
    const [cmd] = parseCommands('echo $(whoami)');
    expect(cmd.hasSubshell).toBe(true);
  });

  it('detects subshell with backticks', () => {
    const [cmd] = parseCommands('echo `whoami`');
    expect(cmd.hasSubshell).toBe(true);
  });

  it('hasPipe is false for single commands without pipe', () => {
    const [cmd] = parseCommands('ls -la');
    expect(cmd.hasPipe).toBe(false);
  });

  it('handles multiple spaces between tokens', () => {
    const [cmd] = parseCommands('rm   -rf   /tmp');
    expect(cmd.cmd).toBe('rm');
    expect(cmd.flags).toContain('-rf');
    expect(cmd.args).toContain('/tmp');
  });

  it('strips quotes from tokens', () => {
    const [cmd] = parseCommands("cat 'file.txt'");
    expect(cmd.args).toContain('file.txt');
  });

  it('preserves quoted string with spaces as single token', () => {
    const [cmd] = parseCommands('echo "hello world"');
    expect(cmd.args).toContain('hello world');
  });
});
