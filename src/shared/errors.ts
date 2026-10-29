export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}
export function killed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'killed' in error && error.killed === true;
}
