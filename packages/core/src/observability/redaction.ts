import type { AttributeRedactor, AttributeValue, Attributes, RedactionPolicy } from "./types";

export const DEFAULT_REDACTION: RedactionPolicy = {
  captureContent: true,
  privacyMode: false,
  maxValueLength: 4096,
  denyKeys: [],
};

const REDACTED = "[REDACTED]";

/** Case-insensitive substrings that always mark an attribute key as secret. */
const ALWAYS_DENY = [
  "authorization",
  "api_key",
  "apikey",
  "access_token",
  "secret",
  "password",
  "credential",
];

export function resolveRedactionPolicy(partial?: Partial<RedactionPolicy>): RedactionPolicy {
  return {
    captureContent: partial?.captureContent ?? DEFAULT_REDACTION.captureContent,
    privacyMode: partial?.privacyMode ?? DEFAULT_REDACTION.privacyMode,
    maxValueLength: partial?.maxValueLength ?? DEFAULT_REDACTION.maxValueLength,
    denyKeys: partial?.denyKeys ?? DEFAULT_REDACTION.denyKeys,
  };
}

/**
 * Builds an {@link AttributeRedactor} for a policy. Content attribute bags are
 * dropped entirely when capture is disabled or privacy mode is on; otherwise
 * denied keys are masked and long string values truncated.
 */
export function createRedactor(policy: RedactionPolicy): AttributeRedactor {
  const denyKeys = [...policy.denyKeys.map((k) => k.toLowerCase()), ...ALWAYS_DENY];
  const contentSuppressed = policy.privacyMode || !policy.captureContent;

  return (attributes: Attributes, content?: boolean): Attributes => {
    if (content && contentSuppressed) {
      return {};
    }
    const result: Attributes = {};
    for (const [key, value] of Object.entries(attributes)) {
      const lowered = key.toLowerCase();
      if (denyKeys.some((deny) => lowered.includes(deny))) {
        result[key] = REDACTED;
        continue;
      }
      result[key] = truncateValue(value, policy.maxValueLength);
    }
    return result;
  };
}

function truncateValue(value: AttributeValue, maxLength: number): AttributeValue {
  if (typeof value === "string" && value.length > maxLength) {
    return `${value.slice(0, maxLength - 1)}…`;
  }
  return value;
}
