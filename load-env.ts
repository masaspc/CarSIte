import { config } from 'dotenv';

// Next.js は .env.local を自動で読むが、drizzle-kit や tsx から動く
// スクリプトは読まないため、ここで明示的に読み込む。
config({ path: '.env.local' });
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL が設定されていません。.env.local にプールなし(-pooler なし)の接続文字列を置いてください。',
  );
}
