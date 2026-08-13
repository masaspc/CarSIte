import '../load-env';
import { db } from '@/db';
import { dealers, grades, models, priceHistory } from '@/db/schema';
import { DuplicateGradeError, modelKeyOf, transformCars, type RawCar } from './seed-transform';
import carsFixture from '../tests/fixtures/cars.json';
import dealersFixture from '../tests/fixtures/dealers.json';

async function main() {
  let data;
  try {
    data = transformCars(carsFixture as RawCar[]);
  } catch (error) {
    if (error instanceof DuplicateGradeError) {
      console.error('シードを中止しました。');
      console.error(error.message);
      console.error(
        '\nこれらは値が食い違う重複です。どちらが正しいかはフィクスチャからは判断できません。',
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(
    `投入対象: models=${data.models.length} grades=${data.grades.length} priceHistory=${data.priceHistory.length}`,
  );

  await db.delete(priceHistory);
  await db.delete(grades);
  await db.delete(models);
  await db.delete(dealers);

  const insertedModels = await db
    .insert(models)
    .values(data.models.map(({ key, ...row }) => row))
    .returning({ id: models.id, manufacturer: models.manufacturer, name: models.name });

  const modelIdByKey = new Map(
    insertedModels.map((m) => [modelKeyOf(m.manufacturer, m.name), m.id]),
  );

  const insertedGrades = await db
    .insert(grades)
    .values(
      data.grades.map(({ key, modelKey, ...row }) => ({
        ...row,
        modelId: modelIdByKey.get(modelKey)!,
      })),
    )
    .returning({ id: grades.id, modelId: grades.modelId, name: grades.name });

  const gradeIdByKey = new Map<string, string>();
  for (const grade of data.grades) {
    const modelId = modelIdByKey.get(grade.modelKey)!;
    const match = insertedGrades.find((g) => g.modelId === modelId && g.name === grade.name)!;
    gradeIdByKey.set(grade.key, match.id);
  }

  if (data.priceHistory.length > 0) {
    await db.insert(priceHistory).values(
      data.priceHistory.map((point) => ({
        gradeId: gradeIdByKey.get(point.gradeKey)!,
        date: point.date,
        price: point.price,
      })),
    );
  }

  await db.insert(dealers).values(
    (dealersFixture as Record<string, unknown>[]).map((d) => ({
      name: d.name as string,
      manufacturer: d.manufacturer as string,
      prefecture: d.prefecture as string,
      city: d.city as string,
      address: d.address as string,
      phone: d.phone as string,
      businessHours: d.businessHours as string,
      closedDays: d.closedDays as string,
      services: d.services as string[],
    })),
  );

  console.log('シード完了。全グレードは draft のため公開ページには出ません。');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
