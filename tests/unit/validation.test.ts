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

  // フォーム経由のグレードもシードと同じ分類になることを担保する
  describe('transmission の導出', () => {
    it('段数付きの表記から type と gearCount を導出する', () => {
      const parsed = gradeInputSchema.parse({ ...valid, transmission: '6AT' });
      expect(parsed).toMatchObject({ transmission: '6AT', transmissionType: 'AT', gearCount: 6 });
    });

    it('無段変速は gearCount を持たない', () => {
      expect(gradeInputSchema.parse({ ...valid, transmission: 'CVT' })).toMatchObject({
        transmissionType: 'CVT',
        gearCount: null,
      });
      expect(gradeInputSchema.parse({ ...valid, transmission: '電気式無段変速機' })).toMatchObject({
        transmissionType: '電気式無段変速機',
        gearCount: null,
      });
    });

    it('分類できない表記は other にするが原文は残す', () => {
      expect(gradeInputSchema.parse({ ...valid, transmission: '謎の変速機' })).toMatchObject({
        transmission: '謎の変速機',
        transmissionType: 'other',
      });
    });

    it('未入力なら3カラムとも null にする', () => {
      expect(gradeInputSchema.parse({ ...valid, transmission: '  ' })).toMatchObject({
        transmission: null,
        transmissionType: null,
        gearCount: null,
      });
      expect(gradeInputSchema.parse(valid)).toMatchObject({
        transmission: null,
        transmissionType: null,
        gearCount: null,
      });
    });

    it('transmissionType や gearCount の直接指定は受け付けない', () => {
      const parsed = gradeInputSchema.parse({
        ...valid,
        transmission: 'CVT',
        transmissionType: 'MT',
        gearCount: 6,
      });
      expect(parsed).toMatchObject({ transmissionType: 'CVT', gearCount: null });
    });
  });

  // JSONB 列はフォームから設定できない仕様（更新時は .set() に現れず既存値が残る）
  it('JSONB 列と取得元メタデータを落とす', () => {
    const parsed = gradeInputSchema.parse({
      ...valid,
      dimensions: { length: 4600 },
      performance: { maxPower: '100kW' },
      fuelDetail: { cityMode: 20 },
      images: { exterior: ['/a.png'] },
      sourceUrl: 'https://example.com',
      fetchedAt: new Date().toISOString(),
    });
    for (const key of ['dimensions', 'performance', 'fuelDetail', 'images', 'sourceUrl', 'fetchedAt']) {
      expect(parsed).not.toHaveProperty(key);
    }
  });
});
