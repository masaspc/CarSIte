import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL が設定されていません');
  }
  return drizzle(neon(url), { schema });
}

type Database = ReturnType<typeof connect>;

let connection: Database | undefined;

function getDb(): Database {
  connection ??= connect();
  return connection;
}

/**
 * 接続はモジュール読み込み時ではなく最初のクエリ時に作る。
 *
 * `import { db } from '@/db'` が throw すると、DATABASE_URL を持たない環境では
 * ビルドの「Collecting page data」段階（=モジュール評価）で失敗し、
 * どのページのどのクエリが原因かも分からないまま止まる。
 * 遅延させることで、失敗するのは実際にクエリを投げたときだけになる。
 *
 * 未設定を握りつぶして空配列を返すようなことはしない。DATABASE_URL がなければ
 * 最初のクエリで必ず上の Error が飛ぶ（=公開データが0件なのか設定漏れなのかを
 * 取り違えない）。
 */
export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = getDb();
    const value = Reflect.get(database, property, database);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

export { schema };
