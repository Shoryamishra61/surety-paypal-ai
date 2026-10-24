import { describe, it, expect } from 'vitest';
import { formatMinor, fromMinor, parseMinor, toMinor, minorExponent } from '../src/core/money';

describe('money: minor-unit arithmetic', () => {
  it('converts two-decimal currencies exactly', () => {
    expect(toMinor(49, 'USD')).toBe(4900);
    expect(toMinor(0.29, 'EUR')).toBe(29);
    expect(toMinor(0.1 + 0.2, 'USD')).toBe(30); // classic float trap rounds to 30 cents
  });
  it('treats zero-decimal currencies as integers', () => {
    expect(toMinor(7500, 'JPY')).toBe(7500);
    expect(() => toMinor(7500.5, 'JPY')).toThrow();
    expect(parseMinor('7500', 'JPY')).toBe(7500);
  });
  it('rejects inexact and negative amounts', () => {
    expect(() => toMinor(0.001, 'USD')).toThrow();
    expect(() => toMinor(-1, 'USD')).toThrow();
    expect(() => toMinor(Number.NaN, 'USD')).toThrow();
    expect(() => toMinor(1, 'XYZ')).toThrow();
  });
  it('parses provider strings strictly', () => {
    expect(parseMinor('0.29', 'USD')).toBe(29);
    expect(parseMinor('12', 'USD')).toBe(1200);
    for (const bad of ['NaN', '1e2', '-1', '0.001', 'Infinity', '00.1', '1.2.3']) {
      expect(() => parseMinor(bad, 'USD'), bad).toThrow();
    }
  });
  it('round-trips and formats like a ledger', () => {
    expect(formatMinor(4900, 'USD')).toBe('USD 49.00');
    expect(formatMinor(7500, 'JPY')).toBe('JPY 7500');
    expect(formatMinor(5, 'USD')).toBe('USD 0.05');
    expect(formatMinor(-120, 'EUR')).toBe('-EUR 1.20');
    expect(fromMinor(4900, 'USD')).toBeCloseTo(49);
    expect(minorExponent('KRW')).toBe(0);
  });
});
