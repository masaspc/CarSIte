import { describe, expect, it } from 'vitest';
import {
  DuplicateGradeError,
  modelKeyOf,
  SeedValidationError,
  transformCars,
  validateSeedGrades,
  type RawCar,
} from '@/scripts/seed-transform';
import carsFixture from '@/tests/fixtures/cars.json';

const MODEL_ID = '0189a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b';

function car(overrides: Partial<RawCar> = {}): RawCar {
  return {
    id: 'toyota-prius-2023-e',
    manufacturer: 'トヨタ',
    model: 'プリウス',
    grade: 'E',
    bodyType: 'ハッチバック',
    price: 2750000,
    releaseDate: '2023-01',
    dimensions: { length: 4600, width: 1780, height: 1430, wheelbase: 2750, weight: 1390, minTurningRadius: 5.4, groundClearance: 130 },
    capacity: { seating: 5 },
    engine: { type: 'ハイブリッド', displacement: 1797, maxPower: '72kW(98PS)', maxTorque: '142N・m', transmission: '電気式無段変速機', driveSystem: 'FF' },
    fuelEfficiency: { wltcMode: 32.6, cityMode: 35, suburbanMode: 34.2, highwayMode: 30.7, ecoCarTax: true },
    safety: { collisionMitigationBrake: true, falseStartSuppression: true, laneDepartureWarning: true, laneKeepingAssist: true, adaptiveCruiseControl: true, blindSpotMonitor: false, camera360: false, parkingAssist: true, airbags: 7 },
    comfort: { navigation: false, etc: false, backCamera: true, powerSeat: false, seatHeater: false, steeringHeater: false, autoAircon: true, ledHeadlight: true, smartKey: true, powerBackDoor: false, handsFreeBackDoor: false, sunroof: false },
    images: { exterior: ['/images/placeholder-car.jpg'], interior: ['/images/placeholder-interior.jpg'] },
    officialUrl: 'https://toyota.jp/prius/',
    description: 'テスト用',
    ...overrides,
  };
}

describe('transformCars', () => {
  it('同一車種の複数グレードを1つのmodelにまとめる', () => {
    const result = transformCars([
      car({ id: 'a', grade: 'E' }),
      car({ id: 'b', grade: 'G', price: 3200000 }),
    ]);

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      manufacturer: 'トヨタ',
      name: 'プリウス',
      manufacturerSlug: 'toyota',
      slug: 'prius',
      bodyType: 'ハッチバック',
    });
    expect(result.grades).toHaveLength(2);
    expect(result.grades.map((g) => g.name)).toEqual(['E', 'G']);
  });

  it('全グレードを draft で投入する', () => {
    const result = transformCars([car()]);
    expect(result.grades[0].publicationStatus).toBe('draft');
  });

  it('装備の true は standard、false は unknown にする', () => {
    const result = transformCars([car()]);
    const grade = result.grades[0];

    expect(grade.collisionMitigationBrake).toBe('standard');
    expect(grade.blindSpotMonitor).toBe('unknown');
    expect(grade.sunroof).toBe('unknown');
  });

  // 分類・段数の導出は共有スキーマ (validateSeedGrades) の仕事。
  // ここで先に導出すると、管理画面とシードで同じ規則が二重定義になる
  it('transmission は諸元表の原文のまま持つ', () => {
    const result = transformCars([car({ engine: { ...car().engine, transmission: '6AT' } })]);
    expect(result.grades[0].transmission).toBe('6AT');
  });

  it('priceHistory を展開する', () => {
    const result = transformCars([
      car({
        priceHistory: [
          { date: '2023-01', price: 2750000 },
          { date: '2024-01', price: 2850000 },
        ],
      }),
    ]);

    expect(result.priceHistory).toHaveLength(2);
    expect(result.priceHistory[0]).toMatchObject({ date: '2023-01', price: 2750000 });
    expect(result.priceHistory[0].gradeKey).toBe(result.grades[0].key);
  });

  it('重複グレードを検出したらエラーで停止する', () => {
    expect(() =>
      transformCars([
        car({ id: 'a', grade: 'X' }),
        car({ id: 'b', grade: 'X', price: 9999999 }),
      ]),
    ).toThrow(DuplicateGradeError);
  });

  it('重複エラーは該当グレードを列挙する', () => {
    try {
      transformCars([car({ grade: 'X' }), car({ grade: 'X' })]);
      expect.unreachable('エラーが投げられていない');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateGradeError);
      expect((error as DuplicateGradeError).duplicates).toEqual(['トヨタ / プリウス / X']);
    }
  });

  it('検索対象外の諸元はJSONBに寄せる', () => {
    const result = transformCars([car()]);
    expect(result.grades[0].dimensions).toMatchObject({ length: 4600, minTurningRadius: 5.4 });
    expect(result.grades[0].performance).toMatchObject({ maxPower: '72kW(98PS)' });
  });

  it('modelKeyOf が transformCars の生成するキーと一致する', () => {
    const result = transformCars([car()]);
    expect(result.models[0].key).toBe(modelKeyOf('トヨタ', 'プリウス'));
    expect(result.grades[0].modelKey).toBe(modelKeyOf('トヨタ', 'プリウス'));
  });

  it('空白を含む車種名でもキーが曖昧にならない', () => {
    expect(modelKeyOf('日産', 'ノート オーラ')).not.toBe(modelKeyOf('日産 ノート', 'オーラ'));
  });

  it('bodyType が enum にない値ならエラーで停止する', () => {
    expect(() => transformCars([car({ bodyType: '空飛ぶ車' } as never)])).toThrow(/bodyType/);
  });

  it('engineType が enum にない値ならエラーで停止する', () => {
    expect(() =>
      transformCars([car({ engine: { ...car().engine, type: '核融合' } } as never)]),
    ).toThrow(/engineType|type/);
  });
});

/**
 * シードの投入値も管理画面と同じ Zod スキーマを通す。
 * 価格上限・乗車定員・重量・排気量の制約が「管理画面だけ」に効いている状態を防ぐ。
 */
describe('validateSeedGrades', () => {
  const validate = (cars: RawCar[]) =>
    validateSeedGrades(transformCars(cars).grades, () => MODEL_ID);

  it('親の modelId を埋めて検証済みの行を返す', () => {
    const [row] = validate([car()]);
    expect(row.modelId).toBe(MODEL_ID);
    expect(row.publicationStatus).toBe('draft');
  });

  it('transmission の分類と段数を管理画面と同じ規則で導出する', () => {
    const [row] = validate([car({ engine: { ...car().engine, transmission: '6AT' } })]);
    expect(row).toMatchObject({ transmission: '6AT', transmissionType: 'AT', gearCount: 6 });
  });

  it('JSONB と装備列を保持したまま通す', () => {
    const [row] = validate([car()]);
    expect(row.dimensions).toMatchObject({ length: 4600 });
    expect(row.performance).toMatchObject({ maxPower: '72kW(98PS)' });
    expect(row.images).toMatchObject({ exterior: ['/images/placeholder-car.jpg'] });
    expect(row.collisionMitigationBrake).toBe('standard');
  });

  it('管理画面と同じ価格上限をシードにも効かせる', () => {
    expect(() => validate([car({ price: 100_000_001 })])).toThrow(SeedValidationError);
  });

  it('乗車定員・重量・排気量の範囲もシードに効かせる', () => {
    expect(() => validate([car({ capacity: { seating: 99 } })])).toThrow(SeedValidationError);
    expect(() =>
      validate([car({ dimensions: { ...car().dimensions, weight: 99_999 } })]),
    ).toThrow(SeedValidationError);
    expect(() =>
      validate([car({ engine: { ...car().engine, displacement: 99_999 } })]),
    ).toThrow(SeedValidationError);
  });

  it('発売年月の形式もシードに効かせる', () => {
    expect(() => validate([car({ releaseDate: '2023/01' })])).toThrow(SeedValidationError);
  });

  it('失敗したグレードを名指しし、全件分まとめて報告する', () => {
    try {
      validate([
        car({ id: 'a', grade: 'E', price: -1 }),
        car({ id: 'b', grade: 'G', capacity: { seating: 0 } }),
      ]);
      expect.unreachable('エラーが投げられていない');
    } catch (error) {
      expect(error).toBeInstanceOf(SeedValidationError);
      const failures = (error as SeedValidationError).failures;
      expect(failures).toHaveLength(2);
      expect(failures.map((f) => f.grade)).toEqual([
        'トヨタ / プリウス / E',
        'トヨタ / プリウス / G',
      ]);
      expect(failures[0].issues.join()).toMatch(/price/);
    }
  });

  // 「103件のフィクスチャは全部通るのか」をレビューのたびに手で確かめない
  it('フィクスチャの全グレードが検証を通る', () => {
    const { grades } = transformCars(carsFixture as RawCar[]);
    expect(grades).toHaveLength(103);
    expect(validateSeedGrades(grades, () => MODEL_ID)).toHaveLength(103);
  });
});
