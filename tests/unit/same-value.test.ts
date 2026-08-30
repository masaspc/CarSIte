import { describe, expect, it } from 'vitest';
import { sameValue } from '@/lib/same-value';

describe('sameValue', () => {
  it('同じ値は同じ', () => {
    expect(sameValue(1, 1)).toBe(true);
    expect(sameValue('a', 'a')).toBe(true);
    expect(sameValue(true, true)).toBe(true);
  });

  it('null と undefined は同じ扱い', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue(null, null)).toBe(true);
  });

  it('片方だけ null なら違う', () => {
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue('', null)).toBe(false);
  });

  it('numeric 文字列と数値を同じとみなす', () => {
    // drizzle の numeric 列は文字列で返る（wltc_mode の "26.0"）
    expect(sameValue('26.0', 26)).toBe(true);
    expect(sameValue(26, '26.0')).toBe(true);
    expect(sameValue('1420', 1420)).toBe(true);
  });

  it('数値にならない文字列同士は文字列として比較する', () => {
    expect(sameValue('FF', 'FF')).toBe(true);
    expect(sameValue('FF', '4WD')).toBe(false);
  });

  it('空文字は数値に落とさない', () => {
    expect(sameValue('', 0)).toBe(false);
    expect(sameValue('   ', 0)).toBe(false);
  });

  it('数値にならない文字列と数値は違う', () => {
    expect(sameValue('¥3,998,500', 3998500)).toBe(false);
  });
});
