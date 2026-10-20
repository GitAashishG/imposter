export function generatePin(): string {
  const values = new Uint32Array(1);
  const unbiasedLimit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  do {
    crypto.getRandomValues(values);
  } while (values[0]! >= unbiasedLimit);
  return (values[0]! % 1_000_000).toString().padStart(6, "0");
}

export function normalizeRecoveryCode(value: string): string {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-F]{32}$/.test(normalized) ? normalized : "";
}

export function formatRecoveryCode(value: string): string {
  const normalized = normalizeRecoveryCode(value);
  return normalized ? normalized.match(/.{4}/g)!.join("-") : "";
}
