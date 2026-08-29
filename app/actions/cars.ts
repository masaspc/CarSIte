'use server';

import { revalidateTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { grades, models } from '@/db/schema';
import { requireAdmin } from '@/auth-guard';
import { assertModelUnchanged, assertSlugUnchanged, gradeInputSchema } from '@/lib/validation';
import { assertModelVerifiedForPublish } from '@/lib/publication';

const gradeIdSchema = z.uuid();
const modelIdSchema = z.uuid();
const publicationStatusSchema = z.enum(['draft', 'published', 'archived']);

/** セッションから GitHub ID を取り出す。検証者の記録に使う */
function githubIdOf(session: Awaited<ReturnType<typeof requireAdmin>>): string {
  return (session.user as Record<string, unknown>).githubId as string;
}

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
  const gradeId = gradeIdSchema.parse(id);
  const data = gradeInputSchema.parse(input);

  const [current] = await db
    .select({ slug: grades.slug, modelId: grades.modelId })
    .from(grades)
    .where(eq(grades.id, gradeId))
    .limit(1);

  if (!current) throw new Error('対象のグレードが見つかりません');

  // フォームが編集不可にしていても、Server Action はフォームを信用しない
  assertSlugUnchanged(current.slug, data.slug);
  assertModelUnchanged(current.modelId, data.modelId);

  // slug と modelId は .set() に含めない。値が同一であることは上で確認済みで、
  // 更新対象から外しておけば将来この経路から書き換わることもない。
  const { slug: _slug, modelId: _modelId, ...updatable } = data;

  await db
    .update(grades)
    .set({
      ...updatable,
      wltcMode: data.wltcMode == null ? null : String(data.wltcMode),
      updatedAt: new Date(),
    })
    .where(eq(grades.id, gradeId));

  revalidateTag('cars');
}

export async function deleteGrade(id: string) {
  await requireAdmin();
  const gradeId = gradeIdSchema.parse(id);
  await db.delete(grades).where(eq(grades.id, gradeId));
  revalidateTag('cars');
}

/** 公開状態の変更は専用の口を通す。通常の編集では動かせない */
export async function setPublicationStatus(
  id: string,
  status: 'draft' | 'published' | 'archived',
) {
  const session = await requireAdmin();
  const gradeId = gradeIdSchema.parse(id);
  const validStatus = publicationStatusSchema.parse(status);
  const githubId = githubIdOf(session);

  // 親の車種が未検証なら公開しない。車種ページは models のメタデータも描画する。
  const [parent] = await db
    .select({
      manufacturer: models.manufacturer,
      name: models.name,
      verifiedAt: models.verifiedAt,
    })
    .from(grades)
    .innerJoin(models, eq(grades.modelId, models.id))
    .where(eq(grades.id, gradeId))
    .limit(1);

  if (!parent) throw new Error('対象のグレードが見つかりません');
  assertModelVerifiedForPublish(validStatus, parent);

  await db
    .update(grades)
    .set({
      publicationStatus: validStatus,
      verifiedAt: validStatus === 'published' ? new Date() : null,
      verifiedBy: validStatus === 'published' ? githubId : null,
      updatedAt: new Date(),
    })
    .where(eq(grades.id, gradeId));

  revalidateTag('cars');
}

/**
 * 車種のメタデータ（車種名・説明・ボディタイプ・公式URL）を人が確認したことを記録する。
 * grades と同じく「誰が・いつ」を残す。これが埋まるまでグレードは公開できない。
 */
export async function setModelVerified(modelId: string) {
  const session = await requireAdmin();
  const id = modelIdSchema.parse(modelId);
  const githubId = githubIdOf(session);

  await db
    .update(models)
    .set({ verifiedAt: new Date(), verifiedBy: githubId, updatedAt: new Date() })
    .where(eq(models.id, id));

  revalidateTag('cars');
}

/**
 * 検証を取り消す。内容に疑いが出た車種を、公開済みグレードごと止めるための口。
 * 公開中のグレードは同時に draft へ戻す（未検証の車種メタデータが
 * 公開ページに残り続けないようにする）。
 */
export async function clearModelVerified(modelId: string) {
  await requireAdmin();
  const id = modelIdSchema.parse(modelId);

  await db
    .update(models)
    .set({ verifiedAt: null, verifiedBy: null, updatedAt: new Date() })
    .where(eq(models.id, id));

  await db
    .update(grades)
    .set({ publicationStatus: 'draft', verifiedAt: null, verifiedBy: null, updatedAt: new Date() })
    .where(and(eq(grades.modelId, id), eq(grades.publicationStatus, 'published')));

  revalidateTag('cars');
}
