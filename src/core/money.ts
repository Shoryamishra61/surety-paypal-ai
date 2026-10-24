// ============================================================
// SURETY — Money.
//
// All arithmetic happens in integer minor units. Currencies with
// different minor-unit exponents (JPY, KRW: 0) are first-class;
// amounts that do not round-trip exactly to their exponent are
// rejected, never silently rounded.
// ============================================================

/** ISO-4217 minor-unit exponents for currencies PayPal settles. */
const MINOR_EXPONENTS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  NZD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  SGD: 2,
  HKD: 2,
  MXN: 2,
  BRL: 2,
  PLN: 2,
  JPY: 0,
  KRW: 0,
  VND: 0,
  HUF: 0,
};

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_EXPONENTS);

export function minorExponent(currency: string): number {
  const exponent = MINOR_EXPONENTS[currency];
  if (exponent === undefined) throw new Error(`Unsupported currency ${currency}`);
  return exponent;
}

/** Convert a float amount to integer minor units; rejects inexact values. */
export function toMinor(amount: number, currency: string): number {
  const exponent = minorExponent(currency);
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error(`${currency} amount must be a finite non-negative number`);
  const scaled = amount * 10 ** exponent;
  const minor = Math.round(scaled);
  if (!Number.isSafeInteger(minor) || Math.abs(scaled - minor) > 1e-7)
    throw new Error(`${currency} amount must have at most ${exponent} decimal places`);
  return minor;
}

/** Parse a provider money string ("49.00", "7500") into minor units. */
export function parseMinor(value: string, currency: string): number {
  const exponent = minorExponent(currency);
  const pattern = exponent === 0 ? /^(0|[1-9]\d{0,12})$/ : /^(0|[1-9]\d{0,10})(\.\d{1,2})?$/;
  if (!pattern.test(value)) throw new Error(`Invalid ${currency} amount string`);
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, '0'));
}

/** Minor units → major-unit float. Use for display only, never arithmetic. */
export function fromMinor(minor: number, currency: string): number {
  minorExponent(currency);
  return minor / 10 ** MINOR_EXPONENTS[currency];
}

/** Render minor units as a canonical ledger string, e.g. "USD 49.00" / "JPY 7500". */
export function formatMinor(minor: number, currency: string): string {
  const exponent = minorExponent(currency);
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(minor)
    .toString()
    .padStart(exponent + 1, '0');
  const whole = absolute.slice(0, absolute.length - exponent) || '0';
  const fraction = exponent ? '.' + absolute.slice(absolute.length - exponent) : '';
  return `${sign}${currency} ${whole}${fraction}`;
}
