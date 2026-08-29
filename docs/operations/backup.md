# バックアップと復旧

収集パイプラインは実データを書き換える。戻せることを確かめてから走らせる。

このドキュメントは**実際に復旧を1度行った記録**である。手順を書いただけのものではない。
実演日: 2026-08-23。

---

## 1. 安全網は3つある。強さの順は逆である

| 手段 | 保持 | 依存 | 何を守るか |
|---|---|---|---|
| **手元のJSON** (`npm run snapshot`) | 消すまで永久 | なし | 「何が入っていたか」。アカウントを失っても残る |
| **Neon ブランチ** | 消すまで永久 | Neonアカウント | ある時点の完全なDB。すぐ繋いで読める |
| **Neon PITR** | **6時間だけ** | Neonアカウント + プラン | 直前の事故。それ以上は遡れない |

### PITR は当てにしない

実測した保持期間は **21600秒 = 6時間**（Free プランの既定値）。

```bash
npx neonctl projects list --org-id <org-id> --output json | grep history_retention_seconds
# → "history_retention_seconds": 21600
```

収集は**毎週月曜 05:00 JST** に走る（`.github/workflows/collect.yml`）。
壊れたデータが入っても、気づくのは早くてその日の朝、遅ければ数日後である。
**そのときPITRの窓はとうに閉じている。**

したがって PITR は「収集の失敗」に対する備えにならない。
**収集を走らせる前にブランチを切る**運用で埋める。保持期間を延ばすには有料プランが要る。

---

## 2. 収集を初めて走らせる前にやること

### 2.1 手元にJSONを取る

```bash
npm run snapshot
```

出力先の `backups/` は `.gitignore` に入っている。中身は取得元サイトの諸元データであり、
リポジトリに入れて配布するものではない。

### 2.2 Neon ブランチを切る

```bash
npx neonctl auth   # 初回のみ
npx neonctl branches create \
  --project-id "$NEON_PROJECT_ID" \
  --name before-first-collect \
  --parent production
```

プロジェクト情報:

| | |
|---|---|
| プロジェクト名 | `carsite` |
| リージョン | `aws-ap-southeast-1` |
| 既定ブランチ | `production` |
| PostgreSQL | 18 |

プロジェクトIDはこのリポジトリに書かない（公開リポジトリのため）。
`npx neonctl projects list` で引けるので、環境変数に入れて使う。

```bash
export NEON_PROJECT_ID=$(npx neonctl projects list --output json \
  | python3 -c 'import json,sys; print(next(p["id"] for p in json.load(sys.stdin) if p["name"]=="carsite"))')
```

---

## 3. 復旧の実演（2026-08-23 実施）

### 3.1 作成したブランチ

```
name:       before-first-collect
parent:     production
created_at: 2026-08-23T14:33:53Z
```

### 3.2 接続して中身を確かめる

**接続文字列は画面に出さない。** 変数に入れて渡す。

```bash
BACKUP_BRANCH_URL=$(npx neonctl connection-string before-first-collect \
  --project-id "$NEON_PROJECT_ID" --pooled false)
export BACKUP_BRANCH_URL

npx tsx -e "
import { neon } from '@neondatabase/serverless';
void (async () => {
  const sql = neon(process.env.BACKUP_BRANCH_URL!);
  const [r] = await sql\`select count(*)::int g,
    count(*) filter (where publication_status='draft')::int d from grades\`;
  console.log(r);
  if (r.g !== 103 || r.d !== 103) process.exit(1);
})();
"
```

`--pooled false` は必須である。プール付きは PgBouncer のトランザクションモードで、
マイグレーションやセッション依存の操作が壊れる（README の前提条件と同じ理由）。

### 3.3 実演の結果

```
{ g: 103, d: 103 }
終了コード: 0
```

全8テーブルの状態:

```
models           100
grades           103   ← 全件 draft
price_history     40
dealers           10
spec_sources       0
spec_documents     0
extractions        0
change_requests    0
```

**全103グレードが `draft` であるのが正しい状態である。** 公開ページが0件表示になるのは
仕様であり、直してはいけない（`CLAUDE.md`）。

---

## 4. 事故が起きたときの戻し方

### 4.1 まず確かめる

壊れた範囲を特定する。収集が原因なら `change_requests` に記録が残っている。

```bash
npx tsx -e "
import './load-env';
import { db } from './db';
import { sql } from 'drizzle-orm';
void (async () => {
  const { rows } = await db.execute(sql\`
    select status, count(*)::int from change_requests group by status\`);
  console.log(rows);
})();
"
```

`change_requests.diff` は適用前後の値を両方持っている。
**1件だけ戻すなら、DB全体を巻き戻すより diff を逆に当てるほうが安全である。**

### 4.2 ブランチごと戻す

復旧ブランチを新しい既定にする。

```bash
npx neonctl branches set-default before-first-collect --project-id "$NEON_PROJECT_ID"
```

`DATABASE_URL` を新しい既定ブランチのものに差し替える（`.env.local` と、
GitHub Actions の `secrets.DATABASE_URL` の両方）。

### 4.3 JSONから入れ直す

Neonごと失った場合の最後の手段。`backups/` の JSON が唯一の情報源になる。
スキーマは `npm run db:migrate` で作り直し、JSONの各テーブルを順に流し込む
（`models` → `grades` → `price_history` の順。外部キーがあるため）。

---

## 5. 収集を定期実行に載せる前のチェック

- [ ] `npm run snapshot` を実行し、`backups/` にJSONがある
- [ ] `before-first-collect` ブランチが存在する
- [ ] そのブランチに接続して `grades` が103件・全件 `draft` であることを確認した
- [ ] `npm run collect -- --dry-run` がDBを変えないことを確認した
- [x] **暗号化PDFの扱いを決めた（2026-08-24）**

暗号化は「受け付けられるか測る」のではなく「送る前に外す」で解決した。
`pipeline/decrypt.ts` の `ensureDecrypted` が抽出直前に `qpdf --decrypt` を通す。
これで Claude API の受け入れ可否にも、メーカーが将来保護設定を変えることにも
左右されない。実測した暗号化は RC4 / R=4 / P=-3372、ユーザーパスワードは空、
`extract for any purpose: allowed`。

**`qpdf` が実行環境に必要である。** macOS は `brew install qpdf`、
GitHub Actions は `collect.yml` が `apt-get install -y qpdf` で入れる。

残っているのはトークン数とコストの実測（Task 16）だけで、これは
`ANTHROPIC_API_KEY` を要する。本実行の直前に行えばよく、収集を始める
前提条件ではない。
