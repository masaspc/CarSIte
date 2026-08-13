/**
 * シードは4テーブルを全削除してから入れ直す。
 * drizzle-orm/neon-http はトランザクションを張れないため、途中で失敗すれば
 * データベースは空か半端な状態で残る。ロールバックで守れない以上、
 * 「そもそも消してよい状態か」を実行前に判定して拒否するしかない。
 *
 * 判定はDBアクセスから切り離した純粋関数にする。実データを壊さずに
 * 単体テストできるようにするため（守るべき性質をテストできない防御は防御ではない）。
 */

export const FORCE_FLAG = '--force';
export const ALLOW_PUBLISHED_FLAG = '--allow-destroying-published';

export interface ExistingDataCounts {
  models: number;
  grades: number;
  priceHistory: number;
  dealers: number;
  /** publication_status が draft 以外（published / archived）のグレード数 */
  nonDraftGrades: number;
}

export interface SeedFlags {
  force: boolean;
  allowDestroyingPublished: boolean;
  /** 認識できなかった引数。タイプミスを黙って無視しないために保持する */
  unknown: string[];
}

export type SeedDecision =
  | { proceed: true }
  | { proceed: false; reason: 'unknown-flag' | 'published-data' | 'existing-data'; message: string };

export function parseSeedFlags(argv: readonly string[]): SeedFlags {
  const flags: SeedFlags = { force: false, allowDestroyingPublished: false, unknown: [] };

  for (const arg of argv) {
    if (arg === FORCE_FLAG) flags.force = true;
    else if (arg === ALLOW_PUBLISHED_FLAG) flags.allowDestroyingPublished = true;
    else flags.unknown.push(arg);
  }

  return flags;
}

function totalRows(counts: ExistingDataCounts): number {
  return counts.models + counts.grades + counts.priceHistory + counts.dealers;
}

function describe(counts: ExistingDataCounts): string {
  return (
    `  models=${counts.models} grades=${counts.grades} ` +
    `priceHistory=${counts.priceHistory} dealers=${counts.dealers}\n` +
    `  うち draft 以外のグレード=${counts.nonDraftGrades} 件`
  );
}

/**
 * 空のデータベース: 無条件で投入してよい（消えるものが無い）。
 * 行はあるが全て draft: --force が要る（クローラ収集済みの未公開データを守る）。
 * published / archived が1件でもある: --force に加えて明示のフラグが要る。
 *   公開済みデータは誰かが目視で検証して verified_at を打った成果物であり、
 *   フィクスチャで上書きすればその検証結果ごと消える。
 */
export function evaluateSeedGuard(counts: ExistingDataCounts, flags: SeedFlags): SeedDecision {
  if (flags.unknown.length > 0) {
    return {
      proceed: false,
      reason: 'unknown-flag',
      message:
        `認識できない引数があります: ${flags.unknown.join(' ')}\n` +
        `使えるのは ${FORCE_FLAG} と ${ALLOW_PUBLISHED_FLAG} だけです。\n` +
        'フラグのタイプミスを「指定なし」として実行しないため、ここで停止します。',
    };
  }

  if (counts.nonDraftGrades > 0) {
    if (!(flags.force && flags.allowDestroyingPublished)) {
      return {
        proceed: false,
        reason: 'published-data',
        message:
          `シードを中止しました。draft 以外のグレードが ${counts.nonDraftGrades} 件あります。\n` +
          `現在のデータベース:\n${describe(counts)}\n` +
          'シードは4テーブルを全削除してから入れ直すため、公開済み・アーカイブ済みの\n' +
          'グレードと、それに紐づく検証結果 (verified_at / verified_by) も消えます。\n' +
          'このドライバ (neon-http) はトランザクションを張れないので、途中で失敗しても戻せません。\n' +
          '本当に破棄してよい場合だけ、次を実行してください:\n' +
          `  npm run db:seed -- ${FORCE_FLAG} ${ALLOW_PUBLISHED_FLAG}`,
      };
    }
    return { proceed: true };
  }

  if (totalRows(counts) > 0) {
    if (!flags.force) {
      return {
        proceed: false,
        reason: 'existing-data',
        message:
          'シードを中止しました。既存データがあります（公開済みのグレードはありません）。\n' +
          `現在のデータベース:\n${describe(counts)}\n` +
          'シードは4テーブルを全削除してから入れ直すため、これらは全て失われます。\n' +
          '破棄して入れ直す場合は、次を実行してください:\n' +
          `  npm run db:seed -- ${FORCE_FLAG}`,
      };
    }
    return { proceed: true };
  }

  return { proceed: true };
}
