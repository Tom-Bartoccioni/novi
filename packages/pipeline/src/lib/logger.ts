export function log(message: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠ ${message}`);
}
