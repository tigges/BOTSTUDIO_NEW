export interface GreetingResult {
  message: string;
  name: string;
  timestamp: string;
}

const NAME_MAX_LENGTH = 64;

/**
 * Normalizes an arbitrary, untrusted name input into a safe display name.
 * Falls back to "world" when the input is empty after trimming.
 */
export function normalizeName(rawName: string | null | undefined): string {
  const trimmed = (rawName ?? "").trim();
  if (trimmed.length === 0) {
    return "world";
  }
  return trimmed.slice(0, NAME_MAX_LENGTH);
}

export function createGreeting(
  rawName: string | null | undefined,
  now: Date = new Date(),
): GreetingResult {
  const name = normalizeName(rawName);
  return {
    message: `Hello, ${name}!`,
    name,
    timestamp: now.toISOString(),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
