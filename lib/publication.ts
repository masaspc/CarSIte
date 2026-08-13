import type { PublicationStatus } from '@/db/schema';

export class UnverifiedModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnverifiedModelError';
  }
}

export interface ParentModel {
  manufacturer: string;
  name: string;
  verifiedAt: Date | null;
}

/**
 * グレードを published にできるのは、親の車種が検証済みのときだけ。
 *
 * 公開ページ (app/cars/[manufacturer]/[model]/page.tsx) は grades だけでなく
 * models.name / description / bodyType / officialUrl も描画し、description は
 * generateMetadata にも入る。grades 側だけ検証しても、未検証の車種メタデータが
 * 1グレードの公開と同時に公開される。
 *
 * DBアクセスから切り離した純粋関数にして、判定そのものを単体テストできるようにする。
 */
export function assertModelVerifiedForPublish(
  status: PublicationStatus,
  model: ParentModel,
): void {
  if (status !== 'published') return;
  if (model.verifiedAt !== null) return;

  throw new UnverifiedModelError(
    `車種「${model.manufacturer} ${model.name}」が未検証のため、このグレードは公開できません。` +
      '車種ページには車種の説明・ボディタイプ・公式URLも表示されるため、' +
      '先に管理画面の「車種の検証」で内容を確認し、検証済みにしてください。',
  );
}
