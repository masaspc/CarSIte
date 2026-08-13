import { describe, expect, it } from 'vitest';
import { gradeInputSchema } from '@/lib/validation';

const valid = {
  modelId: '0189a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b',
  name: 'Z',
  slug: 'z',
  price: 3200000,
  releaseDate: '2023-01',
  engineType: 'ハイブリッド',
  driveSystem: 'FF',
  seating: 5,
};

describe('gradeInputSchema', () => {
  it('妥当な入力を通す', () => {
    expect(gradeInputSchema.safeParse(valid).success).toBe(true);
  });

  it('価格に負数を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('価格に小数を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: 100.5 }).success).toBe(false);
  });

  it('1億円を超える価格を弾く', () => {
    expect(gradeInputSchema.safeParse({ ...valid, price: 100_000_001 }).success).toBe(false);
  });

  it('releaseDate の形式を強制する', () => {
    expect(gradeInputSchema.safeParse({ ...valid, releaseDate: '2023/01' }).success).toBe(false);
    expect(gradeInputSchema.safeParse({ ...valid, releaseDate: '2023-1' }).success).toBe(false);
  });

  it('未知のengineTypeを弾く', () => {
    expect(gradeInputSchema.safeParse({ ...valid, engineType: '核融合' }).success).toBe(false);
  });

  it('装備は未指定なら unknown になる', () => {
    const parsed = gradeInputSchema.parse(valid);
    expect(parsed.sunroof).toBe('unknown');
  });

  it('装備に不正な値を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, sunroof: 'maybe' }).success).toBe(false);
  });

  it('slug に大文字や空白を許さない', () => {
    expect(gradeInputSchema.safeParse({ ...valid, slug: 'Type S' }).success).toBe(false);
  });

  it('定義していないキーを落とす', () => {
    const parsed = gradeInputSchema.parse({ ...valid, publicationStatus: 'published' });
    expect(parsed).not.toHaveProperty('publicationStatus');
  });
});
