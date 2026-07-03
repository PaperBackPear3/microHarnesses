/**
 * Starter set of dangerous-command patterns. This list is intentionally NOT
 * exhaustive — treat it as one layer of defense, not a sandbox. Users should
 * add their own rules via `CompositePolicyEngine.addRule` for their threat
 * model.
 *
 * Each rule matches against a single normalized command segment (already
 * split from compound commands by `normalizeCommand`).
 */

export type Severity = "medium" | "high" | "critical";

export interface CommandPatternRule {
  id: string;
  severity: Severity;
  description: string;
  test(segment: string): boolean;
}

export interface PathPatternRule {
  id: string;
  severity: Severity;
  description: string;
  test(pathValue: string): boolean;
}

const startsWith =
  (word: string) =>
  (segment: string): boolean =>
    new RegExp(`^${word}(\\s|$)`).test(segment);

const containsWord =
  (word: string) =>
  (segment: string): boolean =>
    new RegExp(`(^|\\s)${word}(\\s|$)`).test(segment);

/** Command-shape rules (checked against every normalized command segment). */
export const DEFAULT_COMMAND_RULES: CommandPatternRule[] = [
  {
    id: "sudo",
    severity: "critical",
    description: "Privilege escalation via sudo",
    test: startsWith("sudo"),
  },
  {
    id: "doas",
    severity: "critical",
    description: "Privilege escalation via doas",
    test: startsWith("doas"),
  },
  {
    id: "su-root",
    severity: "critical",
    description: "Switching to another user via su",
    test: (segment) => /^su(\s|$)/.test(segment),
  },
  {
    id: "rm-recursive-force",
    severity: "critical",
    description: "Recursive forced deletion (rm -rf / rm -fr)",
    test: (segment) =>
      /^rm\s+(-[a-zA-Z]*[rR][a-zA-Z]*[fF]|-[a-zA-Z]*[fF][a-zA-Z]*[rR])/.test(segment),
  },
  {
    id: "dd-to-device",
    severity: "critical",
    description: "dd writing to a raw device",
    test: (segment) => /^dd\s.*\bof=\/dev\//.test(segment),
  },
  {
    id: "mkfs",
    severity: "critical",
    description: "Filesystem creation (mkfs)",
    test: (segment) => /^mkfs(\.|\s)/.test(segment),
  },
  {
    id: "fdisk",
    severity: "critical",
    description: "Partition-table manipulation (fdisk / parted / gdisk)",
    test: (segment) => /^(fdisk|parted|gdisk|sgdisk|cfdisk)(\s|$)/.test(segment),
  },
  {
    id: "curl-pipe-shell",
    severity: "critical",
    description: "Piping downloaded content into a shell",
    test: (segment) =>
      /^(curl|wget|fetch)\s.*/.test(segment) &&
      /\|\s*(sh|bash|zsh|fish|python|node|ruby|perl)(\s|$)/.test(segment),
  },
  {
    id: "fork-bomb",
    severity: "critical",
    description: "Classic fork bomb",
    test: (segment) => /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(segment),
  },
  {
    id: "chmod-world-writable",
    severity: "high",
    description: "chmod granting world-writable / world-executable permissions",
    test: (segment) => /^chmod\s+(-[a-zA-Z]+\s+)?(777|a\+rwx|o\+w)(\s|$)/.test(segment),
  },
  {
    id: "chown-root",
    severity: "high",
    description: "Changing ownership to root",
    test: (segment) => /^chown\s+(-[a-zA-Z]+\s+)?root(:|\s)/.test(segment),
  },
  {
    id: "shutdown-reboot",
    severity: "high",
    description: "Halting or restarting the host",
    test: (segment) => /^(shutdown|reboot|halt|poweroff|init\s+[06])(\s|$)/.test(segment),
  },
  {
    id: "kill-all",
    severity: "high",
    description: "kill -9 -1 (send SIGKILL to every process the user owns)",
    test: (segment) => /^kill\s+(-[a-zA-Z0-9]+\s+)*-1(\s|$)/.test(segment),
  },
  {
    id: "history-tampering",
    severity: "medium",
    description: "Clearing shell history",
    test: (segment) =>
      /^history\s+-c(\s|$)/.test(segment) ||
      /rm\s+.*\.(bash|zsh|fish)_history/.test(segment) ||
      /^unset\s+HISTFILE(\s|$)/.test(segment) ||
      /HISTFILE\s*=\s*\/dev\/null/.test(segment),
  },
  {
    id: "secret-exfil",
    severity: "critical",
    description: "Reading a secret file and piping it to a network tool",
    test: (segment) =>
      /(cat|less|more|head|tail)\s.*\.(pem|key|env|pgpass|netrc)/.test(segment) &&
      /\|\s*(curl|wget|nc|ncat|netcat)(\s|$)/.test(segment),
  },
  {
    id: "iptables-flush",
    severity: "high",
    description: "Flushing or resetting host firewall rules",
    test: (segment) =>
      /^(iptables|ip6tables|nft)\s+(-F|--flush|flush\s+ruleset)(\s|$)/.test(segment),
  },
  {
    id: "package-manager-force",
    severity: "medium",
    description: "System package install / removal",
    test: (segment) =>
      /^(apt|apt-get|dnf|yum|zypper|pacman|brew)\s+(install|remove|purge|autoremove|upgrade)(\s|$)/.test(
        segment,
      ) || /^npm\s+install\s+-g(\s|$)/.test(segment),
  },
];

/** Path-shape rules (checked against `file_path` annotated inputs). */
export const DEFAULT_PATH_RULES: PathPatternRule[] = [
  {
    id: "system-path-write",
    severity: "critical",
    description: "Writing into a system directory",
    test: (pathValue) =>
      /^\/(etc|bin|sbin|boot|lib|lib64|usr\/(bin|sbin|lib))(\/|$)/.test(pathValue),
  },
  {
    id: "workspace-escape",
    severity: "high",
    description: "Path escapes the workspace via `..` traversal",
    test: (pathValue) => /(^|\/)\.\.(\/|$)/.test(pathValue),
  },
  {
    id: "home-dotfile-write",
    severity: "medium",
    description: "Writing to a shell rc/profile dotfile",
    test: (pathValue) => /(^|\/)\.(bashrc|zshrc|profile|bash_profile|zprofile)$/.test(pathValue),
  },
];

// Bypass check helpers used by tests to avoid re-implementing the utilities.
export { containsWord as __containsWord, startsWith as __startsWith };
