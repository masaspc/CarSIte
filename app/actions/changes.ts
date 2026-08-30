'use server';

import { revalidateTag } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { changeRequests } from '@/db/schema';
import { requireAdmin } from '@/auth-guard';
import { applyChangeRequest } from '@/pipeline/apply';

const documentIdSchema = z.uuid();

/**
 * 承認・却下は書類（＝諸元表1つ）単位でまとめて行う。設計書7.2 のとおり、
 * グレード単位にすると初回だけで数千回の操作になり現実的でない。
 *
 * 承認と適用は別の操作にしてある。承認だけでは grades は変わらない。
 *
 * 分けている理由は、適用できないものを承認で壊さないためである。諸元表に
 * 車両本体価格が載っていないため、そこから起こした new_grade は grades.price
 * （NOT NULL）を埋められない。1操作にすると、承認した瞬間にそれらが適用不能に
 * 落ちて承認キューから消える。分けておけば、適用を押した結果を見てから
 * 次にどうするかを決められる。
 */
export async function approveDocument(specDocumentId: string): Promise<void> {
  await decideDocument(specDocumentId, 'approved');
}

export async function rejectDocument(specDocumentId: string): Promise<void> {
  await decideDocument(specDocumentId, 'rejected');
}

/**
 * 承認済み（および blocked）の変更を grades へ反映する。
 *
 * neon-http にトランザクションが無いため、1件ずつ独立に適用する。途中で
 * 失敗しても他は進む。applyChangeRequest 自体が条件付き UPDATE で冪等なので、
 * 二度押しても二重には当たらない。
 */
export async function applyDocument(specDocumentId: string): Promise<void> {
  const session = await requireAdmin();
  const id = documentIdSchema.parse(specDocumentId);
  const decidedBy = (session.user as Record<string, unknown>).githubId as string;

  const targets = await db
    .select({ id: changeRequests.id })
    .from(changeRequests)
    .where(
      and(
        eq(changeRequests.specDocumentId, id),
        inArray(changeRequests.status, ['approved', 'blocked']),
      ),
    );

  for (const target of targets) {
    await applyChangeRequest(target.id, decidedBy);
  }

  revalidateTag('cars');
}

async function decideDocument(specDocumentId: string, status: 'approved' | 'rejected') {
  // middleware と layout.tsx だけに認可を依存させない（auth-guard.ts のコメント参照）
  const session = await requireAdmin();
  const id = documentIdSchema.parse(specDocumentId);
  const decidedBy = (session.user as Record<string, unknown>).githubId as string;

  // pending のものだけを動かす。二度押しや、既に適用済みの行には当たらない
  await db
    .update(changeRequests)
    .set({ status, decidedBy, decidedAt: new Date() })
    .where(and(eq(changeRequests.specDocumentId, id), eq(changeRequests.status, 'pending')));

  revalidateTag('cars');
}
