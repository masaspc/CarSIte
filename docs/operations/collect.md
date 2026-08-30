# 収集パイプラインの運用手順

諸元表PDFの収集は「無人の検知」と「有人の取り込み」に役割が分かれている。
設計の背景は `docs/superpowers/specs/2026-08-14-collection-pipeline-design.md` の6章・7章、
実データで確定した制約は同7.4を参照。

| | 誰が | 何を | APIキー |
|---|---|---|---|
| 無人（週1回） | GitHub Actions（`.github/workflows/collect.yml`、毎週月曜05:00 JST） | PDFが変わったかを sha256 で検知し、原本を `storage/pdfs/<sha256>.pdf` に保存する | 不要 |
| 有人（変更時） | 対話セッションの Claude | 保存されたPDFを読んで諸元を起こし、承認キューに積む | 不要 |
| 有人（車種追加時） | 対話セッションの Claude | 装備一覧の色分けをPDFの画像から読み取る | 不要 |

週次ジョブ（`npm run collect`）は変更検知だけを行う。`change_requests` は作らない。
`spec_documents` に「どの車種のどの年月が変わったか」という事実を記録するところで止まる。

## 変更を検知したときの手順

週次ジョブのログ（GitHub Actions の実行結果）に `<車種名>: <年月> は前回と内容が違う` という
行が出たら、以下を行う。

1. **`spec_documents` を見て、どの車種のどの年月が変わったかを確認する**

   ```bash
   npx tsx -e "
   import './load-env';
   import { db } from './db';
   import { sql } from 'drizzle-orm';
   void (async () => {
     const { rows } = await db.execute(sql\`
       select sd.id, sd.document_month, sd.sha256, sd.stored_path, m.name, m.manufacturer
       from spec_documents sd
       join spec_sources ss on ss.id = sd.spec_source_id
       join models m on m.id = ss.model_id
       order by sd.fetched_at desc\`);
     console.log(rows);
   })();
   "
   ```

2. **`storage/pdfs/<sha256>.pdf` の原本を Claude Code に読ませる**

   ステップ1で確認した `sha256` から原本のパスが分かる。対話セッションでこのPDFを読み、
   諸元（型式・重量・寸法・燃費など）を書き起こす。装備一覧は色分けなので画像として読む
   （下記「装備の読み取り方」）。価格は原本に載っていない（下記「価格が取れない」）。

3. **`tests/fixtures/<model-slug>.spec.json` を更新する**

   `ExtractedSpecSchema`（`pipeline/extraction-schema.ts`）の形に合わせて書く。
   既存ファイル `tests/fixtures/prius.spec.json` が実例になる。JSONはリポジトリにコミットし、
   何をどう読んだかを差分で追えるようにする。

4. **取り込む**

   ```bash
   npm run ingest-spec -- --model-slug <slug>
   ```

   `--file <path>` で既定のパス（`tests/fixtures/<slug>.spec.json`）以外を指定できる。
   既存グレードとの差分を計算し、`change_requests` に積む。同じ内容を二度積むことはない
   （`spec_document_id` + `kind` + `target_key` の一意制約）。

5. **`/admin/changes` で確認して承認する**

   承認・却下は諸元表（PDF）**単位**でまとめて行う。個々の変更を選んで承認することはできない
   （`app/actions/changes.ts` の `approveDocument` / `rejectDocument` は、その書類に紐づく
   `pending` の行をすべて同じ状態に変える）。

   **承認と適用は別の操作である。** 承認しただけでは `grades` は変わらない。
   画面のボタンは3つある。

   | ボタン | 何をするか | 対象 |
   |---|---|---|
   | まとめて承認 | `pending` → `approved` | 未承認のもの |
   | **適用** | `grades` へ反映する | `approved` と `blocked` |
   | 却下 | `pending` → `rejected` | 未承認のもの |

   分けてある理由は、適用できないものを承認で壊さないためである。1操作にすると、
   承認した瞬間に適用不能なものが落ちて承認キューから消えてしまう。

   適用の結果は3つに分かれる。

   - **適用成功** … `grades` に反映され、その行は `applied` になる
   - **`blocked`** … 必要な値が欠けていて適用できない。**値が揃えば「適用」を押し直せる**
   - **`stale`** … 対象データが動いていた。上書きせず人間に戻す。差分を見直すこと

   一方で、一意制約 `(spec_document_id, kind, target_key)` は `status` を見ない。
   承認・却下・保留のいずれであっても、同じ書類・種別・対象の行が既に存在すれば
   `ingest-spec` の `onConflictDoNothing` が静かに飛ばす。**再取り込みができないのは
   一意制約のせいであって、`stale` になるからではない。** 値を訂正したい場合は、
   該当する `change_requests` 行を削除してから再実行すること（`ingest-spec` の
   出力で `重複で飛ばした分` が0件より多いときはこの状態を疑う）。

## 新規グレードは承認できない（重要）

`grades.price` は `NOT NULL` だが、諸元表に車両本体価格は載っていない。原本にはこう
書かれている。

> 価格は販売店が独自に定めていますので、詳しくは各販売店にお尋ねください。

そのため `pipeline/apply.ts` の `buildNewGradeValues` は、価格の無い `new_grade` の作成を
拒み、その行を **`blocked`** にする。

**価格は取り込み用JSONに人が入れる。** メーカーのグレードページはJS描画で機械取得
できないため、対話セッションの Claude がブラウザで描画させて読み、`price` に入れる
（`tests/fixtures/prius.spec.json` の `_priceProvenance` に出所を記録してある）。
読んだ値が正しいかは、同じページのWLTC値が諸元表と一致するかで裏を取れる。

**購入価格が存在しないグレードもある。** プリウスの `U` は KINTO専用仕様車で、
月額でしか提供されない。この2件は `price: null` のままで、適用すると `blocked` に
なって承認キューに残る。これは取得の失敗ではなく商品の性質であり、
`grades.price` が NOT NULL である以上そのままでは表現できない。

**諸元表とグレードページで対象集合が違うことがある。** プリウスの `X`
（2,796,200円 / 3,049,200円）はグレードページにあるが、2026-07版の諸元表には
型式が無い。諸元表だけを見ていると取りこぼす。

`blocked` は `stale` とは別物である。`stale` は「対象データが動いていた」で人間が差分を
見直す話、`blocked` は「必要な値が欠けている」で値を入れれば解決する話である。
**`blocked` は承認キューに残り続け、値が揃えば「適用」を押し直せば反映される。**

**現在の状態:** プリウスは価格を入れて取り込み済みで、`new_grade` 8件のうち
**6件が適用され**（`grades` は103→109件）、`U` の2件が `blocked` として
承認キューに残っている。`discontinued` 1件は未承認のままである。
適用された6件は運用者が確認のうえ `published` にしてある。
装備20項目を読み取った `spec_change` 6件も承認・適用済みで、公開6グレードに
`unknown` は1つも残っていない。`discontinued` 1件も承認され、シードの架空グレード
「E」が廃止扱いになった。

**この書類の `discontinued` 1件は、承認する前に中身を確かめること。** 対象はシードの
架空データ（`data/cars.json` 由来）で、実物の諸元表に載っていないため廃止として
検知されている。廃止扱いにしてよいかは人間の判断であり、承認は書類単位でしか
行えないため、`new_grade` 8件と一緒に承認されることになる。

他の車種でも同様に、承認前に対象書類の中身を確認すること。
含まれる場合は、価格の問題が解決するまで承認・却下を保留する。

## 新しい車種を登録する手順

```bash
npm run register-source -- --model-slug <slug> --base-url <url>
```

`<url>` は諸元表PDFのベースパス。年月（`202607`）と `.pdf` を後ろに足してURLを組み立てるため、
末尾は必ず `_` にすること（例: `https://toyota.jp/pages/contents/prius/002_p_002/pdf/spec_`）。
`<slug>` は既存の `models.slug` と一致させる。

## EVを登録できない理由

`spec_sources` に登録できるのは、燃費（`wltc_mode`）が km/L 単位で表現される車種に限られる。
EVの電費は Wh/km（あるいは km/kWh）で、単位系そのものが異なるため、既存の
`wltc_mode` 列にそのまま入れることができない。EVを扱うには列の追加を含む設計変更が要る。

## 装備の読み取り方

諸元表の主要諸元（型式・重量・寸法・燃費など）はテキストとして機械的に取得できるが、
装備一覧表は**色**で情報を表しており、テキスト抽出ではセルが空になる。

| 色 | 意味 | `features` に入れる値 |
|---|---|---|
| 緑 RGB(193,223,196) | 標準装備 | `standard` |
| 橙 RGB(255,233,192) | メーカーオプション | `option` |
| 青 RGB(188,228,250) | 販売店装着オプション | `option` |
| 白 | 設定なし | `none` |

**APIキーは要らない。** 対話セッションの Claude がPDFを画像として読める。手順は次のとおり。

1. `pdftoppm -r 300 -png <pdf> <prefix>` で装備一覧表のページを画像に書き出す
2. 凡例のスウォッチのRGBを基準に、各セルの背景色を判定する
3. **行の同定は目視で行う。** 罫線から行の帯を検出する方式は使わないこと。
   複数行ラベルの開始位置が行の上端より上に出るため、帯とラベルの対応が1行ずれる。
   プリウスでは駐車支援がZとGで逆に出た（`tests/fixtures/prius.spec.json` の
   `_featureProvenance.method` に経緯がある）
4. 読み取った根拠を `_featureProvenance` に残す。どの行を見てどう写したかが
   追えなければ、誤りを見つけても直しようがない

**青（販売店装着オプション）は `option` に含める。** `feature_availability` は
`standard` / `option` / `none` / `unknown` で、工場装着かどうかを区別する値を持たない。
買い手から見た「追加費用を払えば付く」という点でメーカーオプションと同じである。

**列の統合に注意すること。** プリウスの装備一覧表はHEVの「2WD/E-Four」が1列に
統合されている。装備が駆動方式で変わらないということなので、FFと4WDに同じ値を割り当てる。
車種によって統合の仕方が違うので、表頭を必ず確認すること。

### `features` は全グレードに入れるか、1つも入れないか

`ingest-spec` は**全グレードが `features` を持つときだけ**装備を比較する
（`compareOptionsFor`）。一部だけ入れて取り込むと、`normalizeGrades` が欠けたぶんを
`{}` に倒すため `before='unknown'` / `after=null` の空振りの差分が20項目ぶん立ち、
`apply.ts` が `null` を不正値と見て **`blocked`** にする。
「まだ読み取っていない」が「装備を消す変更」になってしまう。

装備を省略したJSONはこれまでどおり検証に通り、装備の差分も立たない。

## 価格が取れないこと

上記「新規グレードは承認できない」のとおり、諸元表に車両本体価格は載っていない。
`ingest-spec` は価格を比較対象から外して差分を計算する（`comparePrice: false`）。
装備は取り込み済みのJSONに対してのみ比較する（上記「装備の読み取り方」）。価格改定そのものの検知は、
別の取得元（価格表PDF・グレード比較ページ等）が用意されるまで、このパイプラインの
対象外になっている。詳細と対処案（A/B/C）は設計書7.4を参照。

## 現状の登録状況

`spec_sources` にはトヨタのプリウスとヤリスが登録済み。EVは前述の理由で登録できない。
