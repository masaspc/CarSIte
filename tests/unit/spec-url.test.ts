import { describe, expect, it } from 'vitest';
import {
  buildPdfUrl,
  candidateMonths,
  isStale,
  monthsBetween,
  parseMonthFromUrl,
} from '@/lib/spec-url';

const BASE = 'https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_';

describe('buildPdfUrl', () => {
  it('YYYY-MM を YYYYMM に変換して .pdf を付ける', () => {
    expect(buildPdfUrl(BASE, '2026-07')).toBe(
      'https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_202607.pdf',
    );
  });

  it('不正な月表記は受け付けない', () => {
    expect(() => buildPdfUrl(BASE, '202607')).toThrow();
    expect(() => buildPdfUrl(BASE, '2026-13')).toThrow();
  });
});

describe('parseMonthFromUrl', () => {
  it('実在のURLから年月を取り出す', () => {
    expect(parseMonthFromUrl(BASE + '202607.pdf')).toBe('2026-07');
  });

  it('年月を含まないURLは null', () => {
    expect(parseMonthFromUrl('https://example.com/spec.pdf')).toBeNull();
  });
});

describe('candidateMonths', () => {
  it('既知の翌月から今月まで、新しい順に並べる', () => {
    expect(candidateMonths('2026-08', '2026-05')).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('既知が今月と同じなら候補は無い（既知の再確認は呼び出し側の仕事）', () => {
    expect(candidateMonths('2026-08', '2026-08')).toEqual([]);
  });

  it('既知が今月より新しい場合も候補は無い', () => {
    expect(candidateMonths('2026-08', '2026-09')).toEqual([]);
  });

  it('年をまたぐ', () => {
    expect(candidateMonths('2026-02', '2025-11')).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('既知が無い初回は maxLookback か月ぶん遡る', () => {
    const months = candidateMonths('2026-08', null, 3);
    expect(months).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('既知が古すぎても maxLookback で打ち切る', () => {
    // 際限なくHEADを投げないための歯止め
    expect(candidateMonths('2026-08', '2000-01', 4)).toHaveLength(4);
  });
});

describe('monthsBetween', () => {
  it('経過月数を返す', () => {
    expect(monthsBetween('2026-07', '2026-08')).toBe(1);
    expect(monthsBetween('2025-08', '2026-08')).toBe(12);
    expect(monthsBetween('2026-08', '2026-08')).toBe(0);
  });
});

describe('isStale', () => {
  it('18か月以上前なら古いと判定する', () => {
    expect(isStale('2025-01', '2026-08')).toBe(true);
  });

  it('18か月未満なら古くない', () => {
    expect(isStale('2026-07', '2026-08')).toBe(false);
    expect(isStale('2025-03', '2026-08')).toBe(false); // 17か月
  });
});
