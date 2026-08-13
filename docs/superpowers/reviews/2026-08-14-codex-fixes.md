# Codex レビュー指摘の修正（2026-08-14）

対象ブランチ: `design/data-foundation`
外部レビュー（Codex）のトリアージを通過した5件を1パスで修正した。

---

## FIX 1 — シードが破壊的かつ非アトミック

### 問題

`scripts/seed.ts` は4テーブルを全削除してから入れ直す。`drizzle-orm/neon-http` は
トランザクションを張れないため、途中で失敗すればデータベースは空か半端な状態で残る。
今はフィクスチャしか入っていないので実害は無いが、次のサブプロジェクトでクローラが
実データを入れ、管理者が公開した後は、`npm run db:seed` の一発で消える。

### 対処

トランザクションが使えない以上、ロールバックでは守れない。**削除より前に「消してよい状態か」を
判定して拒否する**方式にした。

- `scripts/seed-guard.ts`（新規）: DBアクセスから切り離した純粋関数
  `evaluateSeedGuard(counts, flags)` と `parseSeedFlags(argv)`。
  守るべき性質を単体テストできるようにするため、判定とI/Oを分けている。
- `scripts/seed.ts`: 削除の前に4テーブルの行数と「`publication_status` が `draft` 以外」の
  グレード数を数え、判定に通す。拒否なら `process.exit(1)`。

| データベースの状態 | 必要なフラグ |
| --- | --- |
| 空 | 不要 |
| 行はあるが全件 `draft` | `--force` |
| `published` / `archived` が1件以上 | `--force --allow-destroying-published` |

認識できない引数（`--forse` のようなタイプミス）も拒否する。「指定なし」として
実行に進めない。

拒否メッセージには実際の件数と、渡すべきコマンド全体を書いた。

```
シードを中止しました。既存データがあります（公開済みのグレードはありません）。
現在のデータベース:
  models=100 grades=103 priceHistory=40 dealers=10
  うち draft 以外のグレード=0 件
シードは4テーブルを全削除してから入れ直すため、これらは全て失われます。
破棄して入れ直す場合は、次を実行してください:
  npm run db:seed -- --force
```

### 副次的な修正

`models` の UUID をDB任せにせず `randomUUID()` で先に採番するようにした。
grades の検証には親の `modelId` が要るが、それを insert 後にしか知れないと
「削除してから検証する」順序になり、検証失敗が空のDBを残す。
これで **失敗しうる処理は全て削除より前**に寄った。

---

## FIX 2 — 公開が未検証の車種メタデータを露出させる

### 問題

`grades` には `publication_status` / `verified_at` / `verified_by` があるが `models` には無い。
`models.name` / `description` / `officialUrl` / `bodyType` は未検証の取得元データ
（59%は機械生成）で、グレードを1件公開した瞬間に
`app/cars/[manufacturer]/[model]/page.tsx` が描画し、`description` は
`generateMetadata` にも入る。

### 対処

- `db/schema.ts` に `models.verifiedAt` (timestamptz, null) / `models.verifiedBy` (text, null) を追加。
- マイグレーション `drizzle/0001_goofy_venom.sql` を生成・適用。
- `lib/publication.ts`（新規）: `assertModelVerifiedForPublish(status, model)`。
  純粋関数なのでDB無しで単体テストできる。`published` 以外への変更は止めない
  （止めると、未検証と分かった車種を非公開に戻せなくなる）。
- `setPublicationStatus` は親の車種を join で引き、未検証なら
  `UnverifiedModelError`（車種名を名指し）を投げて書き込まない。
- Server Action `setModelVerified(modelId)`: `requireAdmin()` を通し、
  `verified_at = now()` / `verified_by = githubId` を記録する（grades と同じ「誰が・いつ」）。
- Server Action `clearModelVerified(modelId)`: 検証を取り消し、その車種の公開中グレードを
  同時に `draft` へ戻す。取り消せなければ、疑わしくなった車種を止める手段が無い。
- 管理画面 `/admin` に「車種の検証」セクションを追加（未検証を先頭に表示、
  メーカー・車種名・ボディタイプ・公式URL・グレード数・検証状態・操作）。
  グレード表の「公開する」は、親の車種が未検証なら理由付きで無効化する
  （拒否の実体はサーバ側。UIは押せない理由を先に見せるだけ）。

シードは `models` の検証列を埋めない。**シード直後は全車種が未検証**であり、
管理者が内容を確認するまで1件も公開できない。

---

## FIX 3 — 公開後に slug を変更できる

### 問題

`components/CarForm.tsx` は `slug` を自由に編集させる。slug は公開URLの識別子で、
共有された `/compare` のURLと訪問者の localStorage のお気に入りに入っている
（`findPublishedGradesByRefs` が `manufacturerSlug/modelSlug/gradeSlug` で解決する）。
変更すると保存済みの参照が黙って壊れる。

### 対処

- クライアント: `mode === 'add'` でのみ編集可。`mode === 'edit'` では `readOnly`
  （`read-only:` の Tailwind バリアントで見た目も編集不可に）＋理由の注記を表示。
- サーバ: `updateGrade` が現在の slug を読み、異なれば **拒否**する
  （`lib/validation.ts` の `assertSlugUnchanged` / `SlugImmutableError`）。
  さらに `.set()` から slug を外し、この経路では二度と書き換わらないようにした。

**「無視」ではなく「拒否」を選んだ理由**: 黙って捨てると、呼び出し側は変更が保存されたと
思い込んだまま次の操作に進む（管理者は slug を変えたつもりでリンクを配りうる）。
変更が届いた時点でクライアントかコードのどちらかが壊れているのだから、
名指しで止めるほうが安全 — 既存の `DuplicateGradeError` と同じ思想。

---

## FIX 4 — シード経路が Zod スキーマを迂回する

### 問題

仕様は「Zodスキーマを単一の真実の源とする」と書いているのに、`scripts/seed.ts` は
独自の `RawCar` 型と手書きの変換だけで行を作り、`lib/validation.ts` を通っていなかった。
価格上限・乗車定員・重量・排気量の制約は管理画面の入力にしか効いていなかった。

### 対処

規則を複製せず、**共有スキーマを合成**した。

- `lib/validation.ts`: 変換関数を `deriveTransmission` として切り出し、
  `gradeInputSchema`（管理画面）と `seedGradeSchema`（シード）で共有。
  `seedGradeSchema` は `gradeFieldsSchema`（価格・定員・重量・排気量などの制約の定義元）を
  `.extend()` して、フォームには入力欄が無いがシードは値を持つ列だけを足す:
  4つの JSONB（`dimensions` / `performance` / `fuelDetail` / `images` / `extraFeatures`）、
  取得元メタデータ（`sourceUrl` / `fetchedAt`）、そして `publicationStatus: z.literal('draft')`
  （シードが公開状態の行を作れてはならない）。
- `scripts/seed-transform.ts`:
  - `SeedGrade` 型を `Omit<SeedGradeInput, 'modelId'>` から導出。独自の列並びを廃止したので、
    検証されない列をシード経由でだけ増やすことができなくなった。
  - `transmissionType` / `gearCount` の導出をやめ、原文 `transmission` だけを持つ。
    導出は共有スキーマ側に一本化（同じ規則の二重定義を解消）。
  - `wltcMode` を `string` から `number` に変更し、管理画面と同じく insert 直前に文字列化。
  - `validateSeedGrades(grades, modelIdOf)` を追加。1件目で止めず全件検証してから
    `SeedValidationError` を投げ、失敗した行を `メーカー / 車種 / グレード` で名指しし、
    項目ごとの理由を並べる（`DuplicateGradeError` と同じ思想）。
- `scripts/seed.ts`: insert 直前に必ずこれを通す。削除より前に実行するので、
  検証失敗では1行も消えない。

### 結果

**フィクスチャ103行すべてが Zod 検証を通過した。**

```
Zod検証を通過したグレード: 103 / 103 件
```

回帰しないよう、`tests/unit/seed-transform.test.ts` に
「フィクスチャの全グレードが検証を通る」テストを追加した（DB不要）。

`assertEnum`（`bodyType` / `engineType` / `driveSystem`）は残した。これは制約の複製ではなく、
`as` キャスト無しで戻り値の型を確定させるための実行時ナローイングであり、
`bodyType` は grades ではなく models 側の列なので `seedGradeSchema` の対象外である。

---

## FIX 5 — 移行前のデータモデルの残骸

### 問題

`types/car.ts` が `Car` / `Engine` / `Safety` / `Comfort` / `FilterParams` / `SortOption` と、
`6AT` / `10AT` を表現できない `Transmission` union（この移行で直した欠陥そのもの）を
export し続けていた。`types/dealer.ts` の `Dealer` はテーブルと形が違う。
それでいて `FilterSidebar.tsx` と `app/quiz/page.tsx` が `types/car.ts` から enum 型を
import しており、列挙の真実の源が二重化していた。

### 対処

- 削除: `Car` / `Engine` / `Safety` / `Comfort` / `FilterParams` / `SortOption` /
  `Transmission` / `Dimensions` / `Capacity` / `FuelEfficiency` / `Images` /
  `BodyType` / `EngineType` / `DriveSystem`（`types/car.ts`）、`Dealer`（`types/dealer.ts`）。
- 残した: `PriceHistoryPoint`（`PriceHistoryChart` が使用）、
  `prefectures`（`DealersFilter` が使用）。どちらもDBの行に対応しない表示用の値。
  削除した型がどこにあるかを両ファイルの先頭に書いた。
- `db/enums.ts`（新規）: DB enum の値の唯一の定義。`db/schema.ts` はこの配列から
  `pgEnum` を作るので、ここが増減すればDBの型が増減する。
- `components/FilterSidebar.tsx`: 書き写した3つのリテラル配列を削除し、
  `BODY_TYPES` / `ENGINE_TYPES` / `DRIVE_SYSTEMS` を読む。
- `app/quiz/page.tsx`: 未使用だった import を、`BodyType` の型付きヘルパ
  `appendBodyTypes(...)` に置き換え。DBに存在しない表記を書けばコンパイルで落ちる。

**なぜ `db/schema.ts` から値を import しなかったか**: `FilterSidebar` は Client Component で、
`db/schema.ts` を実行時 import すると `drizzle-orm/pg-core` と全テーブル定義が
公開ページのブラウザバンドルに入る（`pgEnum()` は実行時オブジェクトなので tree-shake できない）。
そのため列挙の値だけを drizzle 非依存の葉モジュール `db/enums.ts` に置き、
`db/schema.ts` がそれを消費する形にした。真実の源は1つのままで、型
（`BodyType` など）は従来どおり `db/schema.ts` から export されている。

---

## 検証結果

| 項目 | 結果 |
| --- | --- |
| `npm test` | 9ファイル / **99 passed**（修正前 71） |
| `npm run test:integration` | 3ファイル / **18 passed**（修正前 12） |
| `npx tsc --noEmit` | クリーン |
| `npm run build`（`.next` 削除後のコールドビルド） | ✓ 成功。`npm run lint` は `No ESLint warnings or errors` |
| マイグレーション | `drizzle/0001_goofy_venom.sql` 適用済み。`models.verified_at` (timestamp with time zone) / `models.verified_by` (text) の存在を `information_schema.columns` で確認 |

### 追加したテスト

- `tests/unit/seed-guard.test.ts`（13件）: 空DB／既存データ／`published` あり の3分岐、
  フラグの組み合わせ、`archived` も守ること、ディーラーだけでも守ること、
  タイプミスの拒否、拒否メッセージに件数と正しいコマンドが載ること。
- `tests/unit/publication.test.ts`（4件）: 公開ゲートの純粋関数。
- `tests/unit/validation.test.ts`（+3件）: `assertSlugUnchanged`。
- `tests/unit/seed-transform.test.ts`（+8件）: 共有スキーマ経由の検証、
  価格・定員・重量・排気量・発売年月の制約がシードにも効くこと、
  失敗行の名指し、**フィクスチャ103件が全て通ること**。
- `tests/integration/publication.test.ts`（6件、実DB）: 公開ゲートと slug 不変条件を
  Server Action 経由で検証。`beforeAll`/`afterAll` で元の状態へ厳密に戻す。

### FIX 1 の実地確認（実データベース）

```
$ npm run db:seed                       # 既存データあり・全件 draft
シードを中止しました。既存データがあります（公開済みのグレードはありません）。
...  npm run db:seed -- --force
EXIT=1

$ (1件を published にしてから)
$ npm run db:seed -- --force
シードを中止しました。draft 以外のグレードが 1 件あります。
...  npm run db:seed -- --force --allow-destroying-published
EXIT=1

$ (draft に戻してから)
$ npm run db:seed -- --force
Zod検証を通過したグレード: 103 / 103 件
投入対象: models=100 grades=103 priceHistory=40
シード完了。全グレードは draft のため公開ページには出ません。
車種は未検証 (verified_at = NULL) です。管理画面で検証するまで公開できません。
EXIT=0
```

### FIX 2 の実地確認

`tests/integration/publication.test.ts` が実DBに対して次を確認している。

1. 車種が未検証のあいだ `setPublicationStatus(grade, 'published')` は車種名を含む
   エラーで拒否され、行は `draft` のまま（書き込まれていないことまで確認）。
2. 未検証でも `draft` / `archived` への変更は通る。
3. `setModelVerified(model)` 後は公開でき、`models.verified_by` と `grades.verified_by`
   に実行者が記録される。
4. `clearModelVerified(model)` で検証が外れ、公開中グレードが `draft` に戻る。

### データベースの最終状態

```
FINAL models=100 grades=103 priceHistory=40 dealers=10
FINAL status [{"status":"draft","n":103}] verifiedModels 0
FINAL models.verified columns [
  {"column_name":"verified_at","data_type":"timestamp with time zone"},
  {"column_name":"verified_by","data_type":"text"}
]
```

**draft=103 / published=0**、検証済み車種0件。要求どおり復元済み。
確認に使った一時的な tsx スクリプトは削除済み（`scripts/` に残るのは
`seed.ts` / `seed-guard.ts` / `seed-transform.ts` のみ）。

---

## 懸念・積み残し

1. **`modelId` は編集時に変更を拒否していない。** `CarForm` は編集時に車種の
   `<select>` を `disabled` にしているが、`updateGrade` はサーバ側で検査していない。
   グレードを別の車種へ移すと slug 変更と同じくURL
   （`manufacturerSlug/modelSlug/gradeSlug`）が変わり、保存済みの参照が壊れる。
   今回の指摘の範囲外なので触っていないが、FIX 3 と同じ理由で塞ぐべき。
2. **`--force --allow-destroying-published` は依然としてデータを消せる。**
   要求どおり「上書きの方法」を明示したが、`neon-http` にトランザクションが無い以上、
   このフラグを渡した後の失敗は復旧できない。実データを入れる前に
   バックアップ手順（Neon のブランチ/PITR）を決めておくのが望ましい。
3. **検証の粒度は車種単位。** どの項目（説明・公式URL・ボディタイプ）を確認したかは
   区別せず、`verified_at` が1つ立つだけ。車種メタデータを編集する画面はまだ無いため、
   誤りを見つけた管理者は「検証を取り消す」までしかできない（SQL で直す必要がある）。
4. **`tests/integration/queries.test.ts` は Server Action ではなく `db.update` で直接
   公開状態を変える。** 公開ゲートは Server Action 層にあるので、このテストは
   ゲートを迂回する。テスト用の意図的な近道だが、ゲートをDB制約
   （例: models 未検証なら published を禁じるトリガ）へ落とす選択肢は残っている。
