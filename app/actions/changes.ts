'use server';

import { revalidateTag } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { changeRequests } from '@/db/schema';
import { requireAdmin } from '@/auth-guard';

const documentIdSchema = z.uuid();

/**
 * 承認・却下は書類（＝諸元表1つ）単位でまとめて行う。設計書7.2 のとおり、
 * グレード単位にすると初回だけで数千回の操作になり現実的でない。
 *
 * ここは承認までしか行わない。approved を実際に grades へ反映するのは
 * pipeline/apply.ts の applyChangeRequest で、二重適用を防ぐ条件付き UPDATE を持つ。
 */
export async function approveDocument(specDocumentId: string): Promise<void> {
  await decideDocument(specDocumentId, 'approved');
}

export async function rejectDocument(specDocumentId: string): Promise<void> {
  await decideDocument(specDocumentId, 'rejected');
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
