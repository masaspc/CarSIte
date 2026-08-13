import { z } from 'zod';
import { FEATURE_COLUMNS } from '@/db/schema';
import { parseTransmission } from '@/lib/transmission';

const YYYY_MM = /^\d{4}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const featureValue = z.enum(['standard', 'option', 'none', 'unknown']).default('unknown');

const featureFields = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, featureValue]),
) as Record<(typeof FEATURE_COLUMNS)[number], typeof featureValue>;

const gradeFieldsSchema = z
  .object({
    modelId: z.uuid(),
    name: z.string().min(1).max(60),
    slug: z.string().regex(SLUG, 'slug は小文字英数字とハイフンのみ'),
    price: z.number().int().min(0).max(100_000_000),
    releaseDate: z.string().regex(YYYY_MM, 'YYYY-MM 形式で入力してください').nullish(),
    discontinuedAt: z.string().regex(YYYY_MM).nullish(),
    engineType: z.enum(['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV']),
    driveSystem: z.enum(['FF', 'FR', '4WD', 'MR', 'RR']),
    transmission: z.string().max(40).nullish(),
    seating: z.number().int().min(1).max(12),
    displacement: z.number().int().min(0).max(10_000).nullish(),
    weight: z.number().int().min(0).max(5_000).nullish(),
    wltcMode: z.number().min(0).max(100).nullish(),
    cruisingRange: z.number().int().min(0).max(2_000).nullish(),
    ecoCarTax: z.boolean().default(false),
    airbags: z.number().int().min(0).max(20).nullish(),
    ...featureFields,
  })
  .strip();

/**
 * フォームが入力するのは諸元表の原文 `transmission` だけで、
 * `transmissionType` / `gearCount` はそこから導出する。
 * シード（scripts/seed-transform.ts）と同じ parseTransmission を通すことで、
 * 管理画面から作ったグレードもシード由来の行と同じ分類になる。
 * 導出をやめると、この3カラムに分割している意味（正規化された変速機分類での
 * 絞り込み・比較）がフォーム経由の行だけ失われる。
 *
 * `dimensions` / `performance` / `fuelDetail` / `images` の各 JSONB と
 * `sourceUrl` / `fetchedAt` はこのスキーマでは受け取らない。
 * フォームに入力欄が無く、受け取っても値は常に空になるうえ、
 * JSONB を無検証で通すのは「壊れたデータを黙って通さない」方針に反するため。
 * 更新時は .set() に現れず既存値がそのまま残るので、シードが入れた値を
 * 管理画面からの編集で消してしまうことはない（新規作成時のみ NULL になる）。
 * 入力欄を用意するときは、ここに項目ごとのスキーマを追加してから行うこと。
 *
 * publicationStatus は意図的に含めない。公開状態は setPublicationStatus だけが
 * 動かせる（通常の編集で公開されてしまわないようにする）。
 */
export const gradeInputSchema = gradeFieldsSchema.transform(({ transmission, ...rest }) => {
  const parsed =
    transmission == null || transmission.trim() === '' ? null : parseTransmission(transmission);

  return {
    ...rest,
    transmission: parsed?.raw ?? null,
    transmissionType: parsed?.type ?? null,
    gearCount: parsed?.gearCount ?? null,
  };
});

/** フォームが保持する値（導出前）。CarForm の state はこの型を使う */
export type GradeInput = z.input<typeof gradeInputSchema>;

/** 検証・導出を通した後の、そのまま grades テーブルへ書ける値 */
export type GradeRecord = z.output<typeof gradeInputSchema>;
