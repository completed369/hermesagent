/**
 * Untrusted external content (scraped pages, uploaded documents, competitor
 * listings, customer messages) must never be interpreted as instructions to
 * any agent (master spec sections 15, 27, 31). This is Phase 5 deliverable
 * #6: a real filtering/sanitisation layer that runs on every piece of raw
 * research content before it is stored as an EvidenceArtifact.originalExcerpt
 * or handed to any agent-runtime prompt.
 *
 * This is a pure function -- easy to unit test, and safe to run on the
 * critical path of every acquisition run with no external dependency.
 *
 * Important: this catches *known phrasings* of instruction-injection
 * attempts. It is one layer of defence, not a guarantee that every possible
 * injection is caught -- callers must still always label acquired content as
 * untrusted data (never as instructions) regardless of this function's
 * output, matching the same fail-closed posture used elsewhere in the
 * codebase (e.g. ProductGenerationBlockedError, ApprovalInvalidForExecutionError).
 */

interface InjectionPattern {
  id: string;
  pattern: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: 'ignore_instructions',
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  },
  { id: 'disregard_instructions', pattern: /disregard\s+(the\s+)?(above|previous|prior)/gi },
  { id: 'new_instructions', pattern: /new\s+instructions?\s*:/gi },
  { id: 'role_override', pattern: /you\s+are\s+now\s+(a|an)?\s*/gi },
  { id: 'system_prefix', pattern: /^\s*system\s*:/gim },
  { id: 'assistant_prefix', pattern: /^\s*assistant\s*:/gim },
  { id: 'act_as_different', pattern: /act\s+as\s+(a|an)?\s*(different|another)/gi },
  { id: 'reveal_prompt', pattern: /reveal\s+(your|the)\s+(system\s+)?prompt/gi },
  {
    id: 'forward_data',
    pattern: /forward\s+(all\s+)?(founder|user|private|confidential)\s+data/gi,
  },
  { id: 'jailbreak_mode', pattern: /\b(DAN mode|developer mode|jailbreak)\b/gi },
];

export interface SanitizeResult {
  /** Content with every matched injection phrase replaced by a neutral
   * placeholder -- safe to store/display, never safe to execute as
   * instructions even so. */
  sanitized: string;
  flagged: boolean;
  matches: string[];
}

export function sanitizeUntrustedContent(raw: string): SanitizeResult {
  let sanitized = raw;
  const matches: string[] = [];

  for (const { id, pattern } of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(sanitized)) {
      matches.push(id);
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, '[REDACTED_POTENTIAL_INSTRUCTION]');
    }
  }

  return { sanitized, flagged: matches.length > 0, matches };
}
