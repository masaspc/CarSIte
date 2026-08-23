import './../load-env';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models, specSources } from '@/db/schema';

/**
 * 諸元表PDFのベースパスを spec_sources に登録する。
 *
 *   npm run register-source -- --model-slug prius --base-url https://toyota.jp/.../prius_spec_
 *
 * ベースパスの末尾に年月（202607）と .pdf を足してURLを作るため、
 * 末尾が `_` でないものは受け付けない。
 */
function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export class RegistrationError extends Error {}

/** ベースパスの形を検査する。年月を後ろに付ける前提が崩れると全件404になる */
export function assertBaseUrlShape(baseUrl: string): void {
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new RegistrationError(
      `ベースパスは http(s) で始めてください: ${baseUrl}`,
    );
  }
  if (!baseUrl.endsWith('_')) {
    throw new RegistrationError(
      `ベースパスの末尾は "_" にしてください（年月を後ろに付けるため）: ${baseUrl}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelSlug = args['model-slug'];
  const baseUrl = args['base-url'];

  if (!modelSlug || !baseUrl) {
    throw new RegistrationError(
      '使い方: npm run register-source -- --model-slug <slug> --base-url <url>',
    );
  }

  assertBaseUrlShape(baseUrl);

  const found = await db
    .select({
      id: models.id,
      manufacturer: models.manufacturer,
      name: models.name,
      manufacturerSlug: models.manufacturerSlug,
    })
    .from(models)
    .where(eq(models.slug, modelSlug));

  if (found.length === 0) {
    throw new RegistrationError(`slug "${modelSlug}" の車種が見つかりません`);
  }
  if (found.length > 1) {
    const candidates = found.map((m) => `${m.manufacturerSlug}/${m.name}`).join(', ');
    throw new RegistrationError(
      `slug "${modelSlug}" が複数の車種に一致します（${candidates}）。` +
        'models.slug はメーカー内でしか一意でないため、絞り込めません',
    );
  }

  const model = found[0];

  /*
   * EVを登録しない。
   *
   * grades.wltc_mode は km/L を入れる前提の列で、公開ページの絞り込みと
   * 並び替えがその単位を仮定している。EVの電費は Wh/km なので、同じ列に
   * 混ぜると「燃費のよい順」が壊れる（設計書3章・11章）。
   * パイロットの範囲では登録させない。
   */
  const [ev] = await db
    .select({ name: grades.name })
    .from(grades)
    .where(and(eq(grades.modelId, model.id), eq(grades.engineType, 'EV')))
    .limit(1);

  if (ev) {
    throw new RegistrationError(
      `${model.manufacturer} ${model.name} は EV のグレード（${ev.name}）を含むため登録できません。` +
        'wltc_mode は km/L を入れる列で、EVの電費（Wh/km）とは単位が違います。' +
        '同じ列に混ぜると公開ページの並び替えと絞り込みが壊れます',
    );
  }

  const [existing] = await db
    .select({ id: specSources.id })
    .from(specSources)
    .where(eq(specSources.pdfBaseUrl, baseUrl))
    .limit(1);

  if (existing) {
    console.log(`既に登録済みです: ${baseUrl}`);
    return;
  }

  const [created] = await db
    .insert(specSources)
    .values({ modelId: model.id, pdfBaseUrl: baseUrl })
    .returning({ id: specSources.id });

  console.log(`登録しました: ${model.manufacturer} ${model.name} -> ${baseUrl}`);
  console.log(`spec_sources.id = ${created.id}`);
}

// import されたときは実行しない（テストから assertBaseUrlShape だけ使うため）
if (process.argv[1]?.includes('register-source')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
