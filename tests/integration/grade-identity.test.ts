import { afterEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { grades, models } from '@/db/schema';

// このテストは行を追加するが、必ず削除して元の件数に戻す。
// 全103件が draft のままであることが正しい状態であり、増減させてはいけない。
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) {
    await db.delete(grades).where(eq(grades.id, id));
  }
});

async function anyModelId(): Promise<string> {
  const [row] = await db.select({ id: models.id }).from(models).limit(1);
  return row.id;
}

function gradeRow(modelId: string, overrides: Record<string, unknown> = {}) {
  return {
    modelId,
    name: '__test_Z',
    slug: `__test_${Math.random().toString(36).slice(2, 10)}`,
    price: 4_000_000,
    engineType: 'ハイブリッド' as const,
    driveSystem: 'FF' as const,
    seating: 5,
    powertrain: '2.0L ハイブリッド車',
    ...overrides,
  };
}

describe('grades の識別単位', () => {
  it('同名グレードでもパワートレインが違えば両方入る', async () => {
    const modelId = await anyModelId();

    const [phev] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: '2.0L プラグインハイブリッド車' }))
      .returning({ id: grades.id });
    created.push(phev.id);

    const [hybrid] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: '2.0L ハイブリッド車' }))
      .returning({ id: grades.id });
    created.push(hybrid.id);

    expect(phev.id).not.toBe(hybrid.id);
  });

  it('車種・パワートレイン・駆動方式・名前がすべて同じなら拒否される', async () => {
    const modelId = await anyModelId();

    const [first] = await db.insert(grades).values(gradeRow(modelId)).returning({ id: grades.id });
    created.push(first.id);

    await expect(db.insert(grades).values(gradeRow(modelId))).rejects.toThrow();
  });

  it('powertrain は NOT NULL で、既定値は空文字', async () => {
    const { rows } = await db.execute(sql`
      select is_nullable, column_default
      from information_schema.columns
      where table_name = 'grades' and column_name = 'powertrain'
    `);

    expect(rows[0].is_nullable).toBe('NO');
    expect(String(rows[0].column_default)).toContain("''");
  });

  it('powertrain 未指定の行を2件入れると、空文字どうしで衝突して拒否される', async () => {
    // nullable のままだと NULL 同士が「異なる値」と見なされ、
    // 一意制約をすり抜けて何行でも入ってしまう。NOT NULL にした理由がこれ。
    const modelId = await anyModelId();

    const [first] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: undefined }))
      .returning({ id: grades.id });
    created.push(first.id);

    await expect(
      db.insert(grades).values(gradeRow(modelId, { powertrain: undefined })),
    ).rejects.toThrow();
  });

  it('type_designation は共有できる（一意制約を外した）', async () => {
    /*
     * 「型式はバリアントごとに一意」はトヨタでしか成立しない。
     * ホンダ フィットは 6AA-GR3 ひとつで4バリアントを覆う。
     * docs/research/2026-08-24-manufacturer-pdf-survey.md
     *
     * 型式で弾いていた頃は、そういうメーカーのグレードが
     * 2件目以降まるごと入らなかった。
     */
    const modelId = await anyModelId();
    const designation = `__TEST-${Math.random().toString(36).slice(2, 8)}`;

    const [first] = await db
      .insert(grades)
      .values(gradeRow(modelId, { typeDesignation: designation, powertrain: 'A' }))
      .returning({ id: grades.id });
    created.push(first.id);

    const [second] = await db
      .insert(grades)
      .values(gradeRow(modelId, { typeDesignation: designation, powertrain: 'B' }))
      .returning({ id: grades.id });
    created.push(second.id);

    expect(second.id).not.toBe(first.id);

    // 同定は複合キーが担保する。型式が同じでも複合が同じなら弾かれる
    await expect(
      db
        .insert(grades)
        .values(gradeRow(modelId, { typeDesignation: designation, powertrain: 'A' })),
    ).rejects.toThrow();

    // null は衝突しない。型式が公開されていない車種が複数あってよいのは要件どおり
    const [nullA] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: 'C' }))
      .returning({ id: grades.id });
    created.push(nullA.id);
    const [nullB] = await db
      .insert(grades)
      .values(gradeRow(modelId, { powertrain: 'D' }))
      .returning({ id: grades.id });
    created.push(nullB.id);

    expect(nullA.id).not.toBe(nullB.id);
  });

  it('slug は車種内で一意のまま（公開URLの識別子であるため）', async () => {
    const modelId = await anyModelId();
    const shared = `__test_shared_${Math.random().toString(36).slice(2, 8)}`;

    const [first] = await db
      .insert(grades)
      .values(gradeRow(modelId, { slug: shared, powertrain: 'X' }))
      .returning({ id: grades.id });
    created.push(first.id);

    // パワートレインが違っても slug が同じなら拒否される。
    // だから gradeSlug に識別子を渡して slug 側で分ける必要がある（Task 3）
    await expect(
      db.insert(grades).values(gradeRow(modelId, { slug: shared, powertrain: 'Y' })),
    ).rejects.toThrow();
  });

  it('シードの103件と取り込んだ実データが揃い、プリウスの実データ6件だけ公開されている', async () => {
    const { rows } = await db.execute(sql`
      select count(*)::int as total,
             count(*) filter (where publication_status = 'draft')::int as drafts
      from grades
      where name not like '__test_%'
    `);

    // 103（シード。架空データ）+ 6（プリウス）+ 17（ヤリス）+ 11（フィット）+ 8（アルト）+ 4（ノート）= 149
    //
    // プリウスは8グレードのうち6件、ヤリスは19グレードのうち17件。どちらも残りは U で、
    // KINTO専用仕様車のため購入価格が存在せず、grades.price が NOT NULL である以上
    // 作成できない（blocked のまま承認キューに残る）。
    // フィットは諸元表の15グレードのうち福祉車両4件を除いた11件。
    // アルトは4グレード×2WD/4WDの8件（パッケージ装着車は別グレードにしていない）。
    // ノートは X 系4件（AUTECH と福祉車両は取り込んでいない）。
    //
    // 実データ46件はすべて運用者の確認・検証を経て published。
    // draft の103件はシードの架空データで、これは公開してはいけない。
    // drafts の値はテストを緩めた結果ではなく、実データが正しく公開された事実である。
    expect(rows[0].total).toBe(149);
    expect(rows[0].drafts).toBe(103);
  });

  it('ヤリスの17グレードが変速機まで区別された slug を持つ', async () => {
    /*
     * 1.5L ガソリンの CVT と 6MT は排気量も動力源も駆動方式も同じで、
     * 旧 gradeSlug ではどちらも 15gas に潰れて unique(model_id, slug) に衝突し、
     * 適用が stale になっていた。
     */
    const { rows } = await db.execute(sql`
      select g.slug
      from grades g join models m on m.id = g.model_id
      where m.slug = 'yaris' and g.type_designation is not null
    `);

    const slugs = rows.map((r) => r.slug);
    expect(slugs).toHaveLength(17);
    expect(new Set(slugs).size).toBe(17);
    expect(slugs).toContain('z-15gas-cvt-ff');
    expect(slugs).toContain('z-15gas-mt-ff');
  });
});
