import { describe, expect, it } from 'vitest';
import { parseTransmission } from '@/lib/transmission';

describe('parseTransmission', () => {
  it('段数なしの表記をそのまま分類する', () => {
    expect(parseTransmission('CVT')).toEqual({ raw: 'CVT', type: 'CVT', gearCount: null });
    expect(parseTransmission('MT')).toEqual({ raw: 'MT', type: 'MT', gearCount: null });
  });

  it('段数付きの表記を機構と段数に分ける', () => {
    expect(parseTransmission('6AT')).toEqual({ raw: '6AT', type: 'AT', gearCount: 6 });
    expect(parseTransmission('10AT')).toEqual({ raw: '10AT', type: 'AT', gearCount: 10 });
    expect(parseTransmission('7DCT')).toEqual({ raw: '7DCT', type: 'DCT', gearCount: 7 });
    expect(parseTransmission('6MT')).toEqual({ raw: '6MT', type: 'MT', gearCount: 6 });
  });

  it('電気式無段変速機をそのまま扱う', () => {
    expect(parseTransmission('電気式無段変速機')).toEqual({
      raw: '電気式無段変速機',
      type: '電気式無段変速機',
      gearCount: null,
    });
  });

  it('e-CVT表記をCVTに寄せる', () => {
    expect(parseTransmission('e-CVT')).toEqual({ raw: 'e-CVT', type: 'CVT', gearCount: null });
  });

  it('分類できない表記はotherにし、原文を必ず残す', () => {
    expect(parseTransmission('謎の変速機')).toEqual({
      raw: '謎の変速機',
      type: 'other',
      gearCount: null,
    });
  });

  it('前後の空白を落とす', () => {
    expect(parseTransmission('  6AT  ')).toEqual({ raw: '6AT', type: 'AT', gearCount: 6 });
  });
});
