function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function combineErrors(primary: unknown, secondary: unknown, context: string): Error {
  const combined = new Error(`${errorMessage(primary)}; ${context}: ${errorMessage(secondary)}`);
  (combined as Error & { cause?: unknown }).cause = primary;
  return combined;
}
