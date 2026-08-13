import { describe, expect, it } from 'vitest';
import { DuplicateGradeError, modelKeyOf, transformCars, type RawCar } from '@/scripts/seed-transform';

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

  it('transmission を原文・分類・段数に分ける', () => {
    const result = transformCars([
      car({ engine: { ...car().engine, transmission: '6AT' } }),
    ]);

    expect(result.grades[0]).toMatchObject({
      transmission: '6AT',
      transmissionType: 'AT',
      gearCount: 6,
    });
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
