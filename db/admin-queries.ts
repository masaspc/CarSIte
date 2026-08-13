import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

/** draft を含む全件。管理画面からのみ使う */
export async function listAllGrades() {
  return db
    .select({
      id: grades.id,
      name: grades.name,
      price: grades.price,
      publicationStatus: grades.publicationStatus,
      modelName: models.name,
      manufacturer: models.manufacturer,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .orderBy(asc(models.manufacturer), asc(models.name), asc(grades.price));
}

export async function findGradeById(id: string) {
  const [row] = await db.select().from(grades).where(eq(grades.id, id)).limit(1);
  return row ?? null;
}
