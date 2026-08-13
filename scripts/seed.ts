import '../load-env';
import { randomUUID } from 'node:crypto';
import { ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dealers, grades, models, priceHistory } from '@/db/schema';
import {
  DuplicateGradeError,
  SeedValidationError,
  transformCars,
  validateSeedGrades,
  type RawCar,
} from './seed-transform';
import { evaluateSeedGuard, parseSeedFlags, type ExistingDataCounts } from './seed-guard';
import carsFixture from '../tests/fixtures/cars.json';
import dealersFixture from '../tests/fixtures/dealers.json';

async function countRows(): Promise<ExistingDataCounts> {
  const [[m], [g], [p], [d], [nonDraft]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(models),
    db.select({ n: sql<number>`count(*)::int` }).from(grades),
    db.select({ n: sql<number>`count(*)::int` }).from(priceHistory),
    db.select({ n: sql<number>`count(*)::int` }).from(dealers),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(grades)
      .where(ne(grades.publicationStatus, 'draft')),
  ]);

  return { models: m.n, grades: g.n, priceHistory: p.n, dealers: d.n, nonDraftGrades: nonDraft.n };
}

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

  /**
   * models の UUID をDB任せにせず、ここで採番する。
   * grades の検証には親の modelId が要るが、それをDBの insert 後にしか
   * 知れないと「削除してから検証する」順序になり、検証失敗が空のDBを残す。
   * このドライバ (neon-http) はトランザクションを張れないので、
   * 壊れる可能性のある操作は全て「削除より前」に済ませる。
   */
  const modelIdByKey = new Map(data.models.map((model) => [model.key, randomUUID()]));
  const modelRows = data.models.map(({ key, ...row }) => ({ ...row, id: modelIdByKey.get(key)! }));

  // 削除より前に判定する。「消してよいか」を消した後に聞いても意味がない。
  const decision = evaluateSeedGuard(await countRows(), parseSeedFlags(process.argv.slice(2)));
  if (!decision.proceed) {
    console.error(decision.message);
    process.exit(1);
  }

  // 管理画面からの入力と同じ Zod スキーマを通す。ここで落ちれば1行も消えない。
  const validatedGrades = validateSeedGrades(data.grades, (modelKey) => modelIdByKey.get(modelKey)!);
  console.log(`Zod検証を通過したグレード: ${validatedGrades.length} / ${data.grades.length} 件`);

  console.log(
    `投入対象: models=${data.models.length} grades=${data.grades.length} priceHistory=${data.priceHistory.length}`,
  );

  await db.delete(priceHistory);
  await db.delete(grades);
  await db.delete(models);
  await db.delete(dealers);

  await db.insert(models).values(modelRows);

  const insertedGrades = await db
    .insert(grades)
    .values(
      validatedGrades.map((row) => ({
        ...row,
        wltcMode: row.wltcMode == null ? null : String(row.wltcMode),
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
  console.log('車種は未検証 (verified_at = NULL) です。管理画面で検証するまで公開できません。');
}

main().catch((error) => {
  if (error instanceof SeedValidationError) {
    console.error('シードを中止しました。');
    console.error(error.message);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
