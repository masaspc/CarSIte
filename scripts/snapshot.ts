import '../load-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { db } from '../db';
import {
  changeRequests,
  dealers,
  extractions,
  grades,
  models,
  priceHistory,
  specDocuments,
  specSources,
} from '../db/schema';

/**
 * DBの全行をJSONに書き出す。
 *
 * Neon の PITR やブランチとは別の、依存の少ない安全網である。
 * PITR の保持期間はプランで変わり、ブランチはアカウントを失えば一緒に失われる。
 * 手元のファイルなら、少なくとも「何が入っていたか」は必ず残る。
 *
 * 収集パイプラインが実データを書き換える前に必ず一度取る。
 * 出力先の backups/ は .gitignore に入れてある — 中身は取得元サイトの
 * 諸元データであり、リポジトリに入れて配布するものではない。
 */
const TABLES = {
  models,
  grades,
  priceHistory,
  dealers,
  specSources,
  specDocuments,
  extractions,
  changeRequests,
};

async function main() {
  const snapshot: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const [name, table] of Object.entries(TABLES)) {
    const rows = await db.select().from(table);
    snapshot[name] = rows;
    counts[name] = rows.length;
  }

  const takenAt = new Date().toISOString();
  const body = JSON.stringify({ takenAt, counts, tables: snapshot }, null, 2);
  const digest = createHash('sha256').update(body).digest('hex');

  const directory = path.resolve(__dirname, '..', 'backups');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `snapshot-${takenAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, body);

  console.log('件数:', counts);
  console.log('保存先:', file);
  console.log('sha256:', digest);
}

void main();
