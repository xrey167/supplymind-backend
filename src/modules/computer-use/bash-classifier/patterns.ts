export interface RiskPattern {
  regex: RegExp;
  reason: string;
  name: string;
}

/** Commands blocked outright — too dangerous to execute in any context */
export const HIGH_PATTERNS: RiskPattern[] = [
  // Destructive filesystem wipes
  { name: 'rm-rf-root',     regex: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/(?:\s|$)/, reason: 'Recursive force delete of filesystem root' },
  { name: 'rm-rf-system',   regex: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/(?:etc|usr|bin|boot|lib|sbin|var|home)(?:\/|\s|$)/, reason: 'Recursive force delete of system directory' },
  // Fork bombs
  { name: 'fork-bomb',      regex: /:\s*\(\s*\)\s*\{[^}]*:\s*\|[^}]*:[^}]*&[^}]*\}/, reason: 'Fork bomb pattern detected' },
  { name: 'fork-bomb-alt',  regex: /(\w+)\s*\(\s*\)\s*\{[^}]*\1\s*\|[^}]*\1[^}]*&/, reason: 'Fork bomb variant detected' },
  // Pipe-to-shell (arbitrary remote code execution)
  { name: 'curl-pipe-sh',   regex: /curl\b.*\|\s*(?:ba)?sh\b/, reason: 'Remote code execution via curl pipe to shell' },
  { name: 'wget-pipe-sh',   regex: /wget\b.*\|\s*(?:ba)?sh\b/, reason: 'Remote code execution via wget pipe to shell' },
  { name: 'fetch-pipe-sh',  regex: /fetch\b.*\|\s*(?:ba)?sh\b/, reason: 'Remote code execution via fetch pipe to shell' },
  // Raw disk writes
  { name: 'dd-disk-wipe',   regex: /\bdd\b.*\bof=\/dev\/(?:sd|hd|nvme|vd)/, reason: 'Direct disk write via dd' },
  { name: 'mkfs',           regex: /\bmkfs\b/, reason: 'Filesystem formatting command' },
  { name: 'shred-dev',      regex: /\bshred\b.*\/dev\//, reason: 'Disk shred command' },
  { name: 'wipefs',         regex: /\bwipefs\b/, reason: 'Filesystem signature wipe' },
  // Kernel module manipulation
  { name: 'insmod',         regex: /\binsmod\b/, reason: 'Kernel module insertion' },
  { name: 'modprobe',       regex: /\bmodprobe\b/, reason: 'Kernel module management' },
  { name: 'rmmod',          regex: /\brmmod\b/, reason: 'Kernel module removal' },
  // Privilege escalation
  { name: 'sudo-su',        regex: /\bsudo\s+(?:su|-[si])\b/, reason: 'Privilege escalation via sudo su/sudo -s/sudo -i' },
  { name: 'pkexec',         regex: /\bpkexec\b/, reason: 'Privilege escalation via pkexec' },
  { name: 'su-root',        regex: /(^|&&|;|\|)\s*su(?:\s|$)/, reason: 'Switch user via su command' },
  // Credential exfiltration
  { name: 'shadow-read',    regex: /\bcat\b.*\/etc\/shadow/, reason: 'Read /etc/shadow (password hashes)' },
  { name: 'passwd-exfil',   regex: /\/etc\/passwd.*\|\s*(?:curl|wget)/, reason: 'Exfiltrate /etc/passwd via network' },
];

/** Commands executed but emit a warning event for operator visibility */
export const MEDIUM_PATTERNS: RiskPattern[] = [
  // Targeted destructive deletes (non-root paths)
  { name: 'rm-rf-path',     regex: /rm\s+-[^\s]*r[^\s]*f[^\s]*\s+\/\S+/, reason: 'Recursive force delete of absolute path' },
  // Overly permissive chmod
  { name: 'chmod-777',      regex: /\bchmod\b.*(?:777|a\+rwx|0777)/, reason: 'World-writable permissions' },
  // Package installs (could alter session environment)
  { name: 'apt-install',    regex: /\bapt(?:-get)?\s+install\b/, reason: 'System package installation' },
  { name: 'pip-install',    regex: /\bpip[23]?\s+install\b/, reason: 'Python package installation' },
  { name: 'npm-install-g',  regex: /\bnpm\s+install\s+(?:-g|--global)\b/, reason: 'Global npm package installation' },
  { name: 'gem-install',    regex: /\bgem\s+install\b/, reason: 'Ruby gem installation' },
  { name: 'brew-install',   regex: /\bbrew\s+install\b/, reason: 'Homebrew package installation' },
  // Service management
  { name: 'systemctl-stop', regex: /\bsystemctl\s+(?:stop|restart|disable)\b/, reason: 'System service state change' },
  { name: 'service-stop',   regex: /\bservice\s+\S+\s+(?:stop|restart)\b/, reason: 'Service state change' },
  // Network downloads (no pipe, but still fetching remote content)
  { name: 'wget-download',  regex: /\bwget\b/, reason: 'Remote file download via wget' },
  { name: 'curl-output',    regex: /\bcurl\b.*(?:-[oO]|--output)(?!.*\|.*sh)/, reason: 'Remote file download via curl' },
  // Cron modification
  { name: 'crontab-edit',   regex: /\bcrontab\s+-e\b/, reason: 'Cron schedule modification' },
  { name: 'cron-write',     regex: /\/etc\/cron/, reason: 'Write to system cron directory' },
  // Kill-all processes
  { name: 'kill-all',       regex: /\bkill\s+-9\s+-1\b/, reason: 'Kill all processes' },
  { name: 'killall',        regex: /\bkillall\b/, reason: 'Kill all matching processes' },
  // SSH key modification
  { name: 'ssh-authkeys',   regex: /authorized_keys/, reason: 'SSH authorized keys modification' },
];
