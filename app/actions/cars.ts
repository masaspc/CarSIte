'use server';

import { revalidateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades } from '@/db/schema';
import { requireAdmin } from '@/auth-guard';
import { gradeInputSchema } from '@/lib/validation';

export async function createGrade(input: unknown) {
  await requireAdmin();
  const data = gradeInputSchema.parse(input);

  const [created] = await db
    .insert(grades)
    .values({ ...data, wltcMode: data.wltcMode == null ? null : String(data.wltcMode) })
    .returning({ id: grades.id });

  revalidateTag('cars');
  return created;
}

export async function updateGrade(id: string, input: unknown) {
  await requireAdmin();
  const data = gradeInputSchema.parse(input);

  await db
    .update(grades)
    .set({
      ...data,
      wltcMode: data.wltcMode == null ? null : String(data.wltcMode),
      updatedAt: new Date(),
    })
    .where(eq(grades.id, id));

  revalidateTag('cars');
}

export async function deleteGrade(id: string) {
  await requireAdmin();
  await db.delete(grades).where(eq(grades.id, id));
  revalidateTag('cars');
}

/** 公開状態の変更は専用の口を通す。通常の編集では動かせない */
export async function setPublicationStatus(
  id: string,
  status: 'draft' | 'published' | 'archived',
) {
  const session = await requireAdmin();
  const githubId = (session.user as Record<string, unknown>).githubId as string;

  await db
    .update(grades)
    .set({
      publicationStatus: status,
      verifiedAt: status === 'published' ? new Date() : null,
      verifiedBy: status === 'published' ? githubId : null,
      updatedAt: new Date(),
    })
    .where(eq(grades.id, id));

  revalidateTag('cars');
}
