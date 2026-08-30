import '../load-env';
import { getTableColumns, sql } from 'drizzle-orm';
import { db } from '@/db';
import { FEATURE_COLUMNS, grades } from '@/db/schema';

/**
 * 車種を検証済みにして、そのグレードを公開する。
 *
 *   npm run publish-model -- --model-slug yaris                    # 点検するだけ
 *   npm run publish-model -- --model-slug yaris --verified-by masa # 実際に公開する
 *
 * 公開制御は「未検証データを公開しない」ための仕組みで、models.verified_at が
 * 立っていないとグレードを published にできない（app/actions/cars.ts の
 * assertModelVerifiedForPublish）。誤った車両情報を公開するサイトは有害である、
 * というのが設計の出発点にある（設計書3章）。
 *
 * そのため --verified-by は必須にしてある。「誰が確かめたか」の記録が無いまま
 * 公開できてしまうと、この仕組みは形だけになる。
 *
 * 公開の対象は type_designation を持つグレードに限る。シードの架空データ
 * （data/cars.json 由来。105件のうち62件は生成されたもので実在しない）には
 * 型式が無く、これを公開してはいけない。
 */

export class PublishError extends Error {}

export interface Inspection {
  model: { id: string; name: string; manufacturer: string; bodyType: string; officialUrl: string | null; verifiedBy: string | null };
  publishable: number;
  alreadyPublished: number;
  withoutTypeDesignation: number;
  unknownFeatures: number;
  missingPrice: number;
}

export async function inspect(modelSlug: string): Promise<Inspection> {
  const { rows: models } = await db.execute(sql`
    select id::text as id, name, manufacturer, body_type::text as "bodyType",
           official_url as "officialUrl", verified_by as "verifiedBy"
    from models where slug = ${modelSlug}
  `);
  if (models.length === 0) throw new PublishError(`slug "${modelSlug}" の車種が見つかりません`);
  if (models.length > 1) {
    throw new PublishError(
      `slug "${modelSlug}" が複数の車種に一致します。models.slug はメーカー内でしか一意でありません`,
    );
  }
  const model = models[0] as unknown as Inspection['model'];

  // 装備が1つでも unknown なら比較表がその行を「情報が不足」として出す。
  // 公開前に気づけるよう数えておく
  const unknownChecks = FEATURE_COLUMNS.map(
    (column) => sql`${sql.identifier(dbColumnName(column))}::text = 'unknown'`,
  );

  const { rows } = await db.execute(sql`
    select
      count(*) filter (
        where type_designation is not null and publication_status = 'draft'
      )::int as publishable,
      count(*) filter (where publication_status = 'published')::int as "alreadyPublished",
      count(*) filter (where type_designation is null)::int as "withoutTypeDesignation",
      count(*) filter (
        where type_designation is not null and (${sql.join(unknownChecks, sql` or `)})
      )::int as "unknownFeatures",
      count(*) filter (where type_designation is not null and price is null)::int as "missingPrice"
    from grades where model_id = ${model.id}
  `);

  return { model, ...(rows[0] as unknown as Omit<Inspection, 'model'>) };
}

/**
 * TypeScript の列名から実際のDB列名を引く。
 *
 * 機械的なスネークケース変換ではいけない。camera360 の列名は camera_360 であり、
 * 大文字が無いぶん変換規則では当てられない。定義を単一の出所にする。
 */
function dbColumnName(column: (typeof FEATURE_COLUMNS)[number]): string {
  const name = getTableColumns(grades)[column]?.name;
  if (!name) throw new PublishError(`列 ${column} が grades に見つかりません`);
  return name;
}

export async function publish(modelSlug: string, verifiedBy: string): Promise<number> {
  const state = await inspect(modelSlug);
  const now = new Date();

  await db.execute(sql`
    update models set verified_at = ${now}, verified_by = ${verifiedBy}, updated_at = ${now}
    where id = ${state.model.id}
  `);

  const { rows } = await db.execute(sql`
    update grades set publication_status = 'published', verified_at = ${now},
           verified_by = ${verifiedBy}, updated_at = ${now}
    where model_id = ${state.model.id}
      and type_designation is not null
      and publication_status = 'draft'
    returning slug
  `);
  return rows.length;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelSlug = args['model-slug'];
  const verifiedBy = args['verified-by'];

  if (!modelSlug) {
    throw new PublishError(
      '使い方: npm run publish-model -- --model-slug <slug> [--verified-by <名前>]\n' +
        '  --verified-by なしで実行すると、公開せずに点検結果だけを出す',
    );
  }

  const state = await inspect(modelSlug);
  const { model } = state;

  console.log(`${model.manufacturer} ${model.name}`);
  console.log(`  ボディタイプ  ${model.bodyType}`);
  console.log(`  公式URL       ${model.officialUrl ?? '（未設定）'}`);
  console.log(`  検証者        ${model.verifiedBy ?? '（未検証）'}`);
  console.log(`  公開できる    ${state.publishable} 件（draft かつ型式あり）`);
  console.log(`  公開済み      ${state.alreadyPublished} 件`);
  console.log(`  型式なし      ${state.withoutTypeDesignation} 件（シードの架空データ。公開しない）`);
  console.log(`  装備が unknown ${state.unknownFeatures} 件`);
  console.log(`  価格なし      ${state.missingPrice} 件`);

  if (state.unknownFeatures > 0) {
    console.log(
      '\n【要確認】装備が unknown のグレードがある。比較表でその行が「情報が不足」と出る。' +
        '先に装備を取り込むこと（docs/operations/collect.md「装備の読み取り方」）',
    );
  }

  if (!verifiedBy) {
    console.log(
      '\n公開するには --verified-by <名前> を付ける。' +
        '車種メタデータ（車種名・メーカー・ボディタイプ・公式URL）が正しいことを' +
        '確かめた人の名前が models.verified_by に残る',
    );
    return;
  }

  if (state.publishable === 0) {
    console.log('\n公開できるグレードがありません');
    return;
  }

  const published = await publish(modelSlug, verifiedBy);
  console.log(`\n${model.name} を検証済みにして ${published} 件を公開しました（検証者: ${verifiedBy}）`);
}

if (process.argv[1]?.includes('publish-model')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
