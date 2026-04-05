# Bash Risk Classifier — Design Spec

**Date:** 2026-04-05
**Status:** Approved
**Scope:** Computer-use bash tool hardening

---

## Problem

The computer-use bash tool executes arbitrary shell commands inside headless agent sessions. There is currently no guard against catastrophic commands (`rm -rf /`, fork bombs, pipe-to-shell exploits) or medium-risk operations worth monitoring (package installs, service restarts, network downloads).

---

## Approach

Two-layer classification with zero added latency on non-matching commands:

1. **Raw-string scan** — regex patterns against the raw command string. Catches the obvious cases immediately.
2. **Shell tokenization** — parse the command into sub-commands + tokens, then apply token-aware patterns. Catches edge cases: extra whitespace, quoting, chained commands (`cmd1 && cmd2`), subshell injection.

Both layers run on every command. The highest risk level from either layer wins.

---

## New Module: `src/modules/computer-use/bash-classifier/`

```
bash-classifier/
  patterns.ts       — HIGH/MEDIUM pattern definitions
  shell-parse.ts    — minimal shell tokenizer
  classifier.ts     — classifyCommand(cmd): ClassifyResult
  index.ts          — barrel export
```

### `patterns.ts`

**HIGH risk** (block execution):

| Category | Examples |
|---|---|
| Destructive filesystem | `rm -rf /`, `rm -rf /etc`, `rm -rf /usr`, `rm -rf /bin`, `rm -rf /boot`, `rm -rf /home` |
| Fork bomb | `: () { :\|:& }; :`, `bomb() { bomb\|bomb& }` |
| Pipe-to-shell | `curl \| bash`, `curl \| sh`, `wget \| bash`, `wget \| sh`, `fetch \| sh` |
| Raw disk write | `dd if=... of=/dev/sd*`, `dd if=... of=/dev/hd*` |
| Kernel modules | `insmod`, `modprobe`, `rmmod` |
| Privilege escalation | `sudo su`, `sudo -s`, `sudo -i`, `pkexec`, `su -` |
| Credential exfiltration | `cat /etc/shadow`, `cat /etc/passwd \| curl`, `cat /etc/passwd \| wget` |
| Filesystem wipe tools | `mkfs.*`, `shred /dev/`, `wipefs` |

**MEDIUM risk** (execute + emit warning event):

| Category | Examples |
|---|---|
| Targeted destructive delete | `rm -rf` with non-root absolute path |
| Overly permissive chmod | `chmod 777`, `chmod a+rwx`, `chmod 0777` |
| Global package installs | `apt install`, `apt-get install`, `pip install`, `npm install -g`, `gem install`, `brew install` |
| Service management | `systemctl restart`, `systemctl stop`, `service * restart`, `service * stop` |
| Network downloads (no pipe) | `wget <url>`, `curl -O`, `curl -o` |
| Cron modification | `crontab -e`, writes to `/etc/cron*` |
| Process kill-all | `kill -9 -1`, `killall`, `pkill -9` |
| SSH key modification | writes to `~/.ssh/authorized_keys` |

### `shell-parse.ts`

Tokenizes a raw bash string into an array of sub-commands. Each sub-command has:
```typescript
interface ParsedCommand {
  raw: string;       // original text of this sub-command
  cmd: string;       // command name (first token)
  flags: string[];   // tokens starting with -
  args: string[];    // remaining tokens
  hasSubshell: boolean; // contains $() or backtick
  hasPipe: boolean;     // output piped to another command
}
```

Splits on `;`, `&&`, `||`, `|` (respecting quotes). Strips quotes from tokens. Detects `$()` and backtick subshells.

### `classifier.ts`

```typescript
export interface ClassifyResult {
  risk: 'high' | 'medium' | 'low';
  reason?: string;
  matchedPattern?: string;
}

export function classifyCommand(raw: string): ClassifyResult
```

Algorithm:
1. Run raw-string HIGH patterns → if match, return `{ risk: 'high', reason, matchedPattern }`
2. Run raw-string MEDIUM patterns → record best match
3. Tokenize into sub-commands
4. For each sub-command: run token-aware HIGH patterns → if match, return `high`
5. For each sub-command: run token-aware MEDIUM patterns → record best match
6. Return highest match found, or `{ risk: 'low' }` if none

---

## Wiring: `computer-use.tools.ts`

In the bash tool handler, before spawning the subprocess:

```typescript
import { classifyCommand } from './bash-classifier';

const classification = classifyCommand(command);

if (classification.risk === 'high') {
  return { error: `Command blocked (${classification.matchedPattern}): ${classification.reason}` };
}

if (classification.risk === 'medium') {
  eventBus.emit('computer-use.bash.warning', {
    sessionId,
    workspaceId,
    command,
    reason: classification.reason,
    matchedPattern: classification.matchedPattern,
  });
  logger.warn({ sessionId, command, ...classification }, 'Risky bash command — executing with warning');
}

// proceed with subprocess spawn
```

---

## What This Does NOT Change

- No new DB tables
- No new API routes
- No changes to the agent execution flow
- Warning events are fire-and-forget (observers can subscribe via event bus for alerting)

---

## Testing

Unit tests for `classifier.ts` covering:
- Each HIGH pattern category → blocked
- Each MEDIUM pattern category → warn
- Benign commands (`ls`, `cat file.txt`, `echo hello`) → low
- Edge cases: extra whitespace in `rm  -rf  /`, quoted paths, chained commands with `&&`, subshell injection `rm -rf $(echo /)`
- Token-layer catches what raw-string misses

---

## Future Extensions

- Per-workspace HIGH/MEDIUM overrides via feature flags (e.g., allow `apt install` for a trusted workspace)
- Warning event consumer that triggers a notification via Novu
