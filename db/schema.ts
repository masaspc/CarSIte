import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  BODY_TYPES,
  CHANGE_KINDS,
  CHANGE_STATUSES,
  DRIVE_SYSTEMS,
  ENGINE_TYPES,
  FEATURE_AVAILABILITIES,
  PUBLICATION_STATUSES,
  TRANSMISSION_TYPES,
} from './enums';

// 列挙値の実体は db/enums.ts。Client Component から drizzle 抜きで読めるようにするため
// 値だけを別ファイルに置き、DBの型はそこから組み立てる。
export const bodyTypeEnum = pgEnum('body_type', BODY_TYPES);
export const engineTypeEnum = pgEnum('engine_type', ENGINE_TYPES);
export const driveSystemEnum = pgEnum('drive_system', DRIVE_SYSTEMS);
export const transmissionTypeEnum = pgEnum('transmission_type', TRANSMISSION_TYPES);
export const featureAvailabilityEnum = pgEnum('feature_availability', FEATURE_AVAILABILITIES);
export const publicationStatusEnum = pgEnum('publication_status', PUBLICATION_STATUSES);

export type BodyType = (typeof bodyTypeEnum.enumValues)[number];
export type EngineType = (typeof engineTypeEnum.enumValues)[number];
export type DriveSystem = (typeof driveSystemEnum.enumValues)[number];
export type TransmissionType = (typeof transmissionTypeEnum.enumValues)[number];
export type FeatureAvailability = (typeof featureAvailabilityEnum.enumValues)[number];
export type PublicationStatus = (typeof publicationStatusEnum.enumValues)[number];

/** 検索対象になるコア装備。これ以外は grades.extraFeatures (JSONB) に逃がす */
export const FEATURE_COLUMNS = [
  'collisionMitigationBrake', 'falseStartSuppression', 'laneDepartureWarning',
  'laneKeepingAssist', 'adaptiveCruiseControl', 'blindSpotMonitor',
  'camera360', 'parkingAssist',
  'navigation', 'etc', 'backCamera', 'powerSeat', 'seatHeater', 'steeringHeater',
  'autoAircon', 'ledHeadlight', 'smartKey', 'powerBackDoor',
  'handsFreeBackDoor', 'sunroof',
] as const;

export type FeatureColumn = (typeof FEATURE_COLUMNS)[number];

const feature = (columnName: string) =>
  featureAvailabilityEnum(columnName).notNull().default('unknown');

const YYYY_MM = (column: string) => sql.raw(`${column} ~ '^[0-9]{4}-[0-9]{2}$'`);

export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manufacturer: text('manufacturer').notNull(),
    manufacturerSlug: text('manufacturer_slug').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    bodyType: bodyTypeEnum('body_type').notNull(),
    officialUrl: text('official_url'),
    description: text('description'),
    /**
     * grades と同じ意味の検証記録。name / description / officialUrl / bodyType は
     * 未検証の取得元データがそのまま入っており、グレードを1件公開しただけで
     * 車種ページと generateMetadata に露出する。グレードの公開は
     * この2列が埋まっている車種にだけ許す（app/actions/cars.ts）。
     */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('models_manufacturer_name_key').on(t.manufacturer, t.name),
    unique('models_slug_key').on(t.manufacturerSlug, t.slug),
    index('models_body_type_idx').on(t.bodyType),
  ],
);

export const grades = pgTable(
  'grades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    publicationStatus: publicationStatusEnum('publication_status').notNull().default('draft'),

    price: integer('price').notNull(),
    releaseDate: text('release_date'),
    discontinuedAt: text('discontinued_at'),

    engineType: engineTypeEnum('engine_type').notNull(),
    driveSystem: driveSystemEnum('drive_system').notNull(),
    transmission: text('transmission'),
    transmissionType: transmissionTypeEnum('transmission_type'),
    gearCount: smallint('gear_count'),
    seating: smallint('seating').notNull(),
    displacement: integer('displacement'),
    weight: integer('weight'),
    wltcMode: numeric('wltc_mode', { precision: 4, scale: 1 }),
    cruisingRange: integer('cruising_range'),
    ecoCarTax: boolean('eco_car_tax').notNull().default(false),
    airbags: smallint('airbags'),

    dimensions: jsonb('dimensions'),
    performance: jsonb('performance'),
    fuelDetail: jsonb('fuel_detail'),
    images: jsonb('images'),
    extraFeatures: jsonb('extra_features').notNull().default({}),

    collisionMitigationBrake: feature('collision_mitigation_brake'),
    falseStartSuppression: feature('false_start_suppression'),
    laneDepartureWarning: feature('lane_departure_warning'),
    laneKeepingAssist: feature('lane_keeping_assist'),
    adaptiveCruiseControl: feature('adaptive_cruise_control'),
    blindSpotMonitor: feature('blind_spot_monitor'),
    camera360: feature('camera_360'),
    parkingAssist: feature('parking_assist'),
    navigation: feature('navigation'),
    etc: feature('etc'),
    backCamera: feature('back_camera'),
    powerSeat: feature('power_seat'),
    seatHeater: feature('seat_heater'),
    steeringHeater: feature('steering_heater'),
    autoAircon: feature('auto_aircon'),
    ledHeadlight: feature('led_headlight'),
    smartKey: feature('smart_key'),
    powerBackDoor: feature('power_back_door'),
    handsFreeBackDoor: feature('hands_free_back_door'),
    sunroof: feature('sunroof'),

    /**
     * 車両型式（例 6LA-MXWH61-AHXHB）。国交省の型式指定。
     *
     * **識別子としては使わない。** 「バリアントごとに一意」という前提は
     * トヨタでしか成立しない（下の一意制約のコメント参照）。諸元の1項目として持つ。
     * 諸元表に載っていない車種もあるため null 可。
     */
    typeDesignation: text('type_designation'),

    /**
     * 諸元表の列見出しの原文（例「2.0L プラグインハイブリッド車」）。
     *
     * NOT NULL は必須である。nullable にすると PostgreSQL は UNIQUE 制約で
     * NULL 同士を「異なる値」として扱うため、下の複合一意制約をすり抜けて
     * 同名グレードが何行でも入る。値が取れない場合は空文字を入れる。
     *
     * engine_type（正規化した分類）とは別物。同じ「ハイブリッド」の中で
     * 排気量違いを区別するために原文が要る。transmission を raw と type に
     * 分けたのと同じ理屈である。
     */
    powertrain: text('powertrain').notNull().default(''),

    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // unique('grades_model_name_key') は削除した。
    // プリウスの諸元表には同名の「Z」「G」がパワートレイン違いで2つずつあり、
    // 車種と名前だけでは1車種のうちに衝突する（設計書2.4）。
    unique('grades_model_powertrain_drive_name_key').on(
      t.modelId,
      t.powertrain,
      t.driveSystem,
      t.name,
    ),
    /*
     * 型式単独の UNIQUE は削除した（2026-08-24）。
     *
     * 「型式はバリアントごとに一意」という前提はトヨタでしか成立しない。
     * 4車種を実測した結果:
     *
     *   トヨタ プリウス   8バリアント / 型式8種  ○
     *   トヨタ アクア     9バリアント / 型式9種  ○
     *   スズキ アルト     8バリアント / 型式2種  ✗
     *   ホンダ フィット  15バリアント / 型式6種  ✗
     *
     * ホンダは 6AA-GR3 ひとつで e:HEV X/FF・e:HEV Z/FF・e:HEV RS/FF・
     * 助手席回転シート車 e:HEV Z/FF の4件を覆う。これらは name だけが違うため、
     * 型式を含むどんな複合キーを作っても name を含めない限り区別できない。
     *
     * name を含めた時点で grades_model_powertrain_drive_name_key と同じ
     * 判別力になり、型式を足す意味が無い。よって型式にかかる一意制約は置かない。
     * グレードの同一性は上の複合キーが担保する。
     *
     * 「ひとつの型式が複数の車種にまたがらない」という不変条件は残るが、
     * これは単純な UNIQUE では表現できないため、収集時の検査で見る。
     */
    // slug は公開URLの識別子なので車種内で一意のまま。衝突は slug の生成規則側で
    // 避ける（lib/slug.ts の gradeSlug に識別子を渡す）
    unique('grades_model_slug_key').on(t.modelId, t.slug),
    index('grades_model_id_idx').on(t.modelId),
    index('grades_status_price_idx').on(t.publicationStatus, t.price),
    index('grades_status_wltc_idx').on(t.publicationStatus, t.wltcMode),
    index('grades_engine_type_idx').on(t.engineType),
    index('grades_seating_idx').on(t.seating),
    check('grades_release_date_format', YYYY_MM('release_date')),
    check('grades_discontinued_at_format', YYYY_MM('discontinued_at')),
  ],
);

export const priceHistory = pgTable(
  'price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gradeId: uuid('grade_id').notNull().references(() => grades.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    price: integer('price').notNull(),
    sourceUrl: text('source_url'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('price_history_grade_date_key').on(t.gradeId, t.date),
    index('price_history_grade_idx').on(t.gradeId),
    check('price_history_date_format', YYYY_MM('date')),
  ],
);

export const dealers = pgTable(
  'dealers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    manufacturer: text('manufacturer').notNull(),
    prefecture: text('prefecture').notNull(),
    city: text('city'),
    address: text('address'),
    phone: text('phone'),
    businessHours: text('business_hours'),
    closedDays: text('closed_days'),
    services: jsonb('services').notNull().default([]),
  },
  (t) => [
    index('dealers_prefecture_idx').on(t.prefecture),
    index('dealers_manufacturer_idx').on(t.manufacturer),
  ],
);

export const changeKindEnum = pgEnum('change_kind', CHANGE_KINDS);
export const changeStatusEnum = pgEnum('change_status', CHANGE_STATUSES);

export type ChangeKind = (typeof changeKindEnum.enumValues)[number];
export type ChangeStatus = (typeof changeStatusEnum.enumValues)[number];

/**
 * 車種ごとの諸元表PDFのベースパス。人が一度だけ登録する。
 *
 * ページを描画してリンクを拾うのではなく、ベースパスに年月を付けて
 * HEAD で探索する（設計書7.1）。ベースパス中のセクションID（005_p_001 など）は
 * 車種ごとに違い推測できないため、ここだけは人の登録に頼る。
 */
export const specSources = pgTable(
  'spec_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelId: uuid('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
    /** 例: https://toyota.jp/pages/contents/prius/005_p_001/pdf/prius_spec_ */
    pdfBaseUrl: text('pdf_base_url').notNull(),
    /** 前回200が返った年月。初回は null で、maxLookback ぶん遡って探す */
    knownMonth: text('known_month'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    /** 3に達したら「取得不能」として人間に上げる（設計書8章） */
    consecutiveFailures: smallint('consecutive_failures').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    unique('spec_sources_base_url_key').on(t.pdfBaseUrl),
    index('spec_sources_model_id_idx').on(t.modelId),
    check('spec_sources_known_month_check', sql`${t.knownMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/**
 * 実際に取得したPDF。同じ内容を二度登録しないよう sha256 に一意制約を張る。
 *
 * stored_path にPDF原本を保存する。Structured Outputs はスキーマで要求した項目しか
 * 返さないため、後から項目を足したくなったとき extractions.raw_output には入っていない。
 * メーカーのURLは改定のたびに差し替わるので、後から取り直せる保証もない（設計書5.2）。
 */
export const specDocuments = pgTable(
  'spec_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specSourceId: uuid('spec_source_id')
      .notNull()
      .references(() => specSources.id, { onDelete: 'cascade' }),
    pdfUrl: text('pdf_url').notNull(),
    documentMonth: text('document_month').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    pageCount: smallint('page_count').notNull(),
    storedPath: text('stored_path'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('spec_documents_source_sha_key').on(t.specSourceId, t.sha256),
    index('spec_documents_source_id_idx').on(t.specSourceId),
    check('spec_documents_month_check', sql`${t.documentMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
  ],
);

/**
 * LLM抽出の生結果。成功・失敗を問わず残す。
 *
 * PDFのLLM処理が唯一の実コストなので、二度払わない設計にする。
 * スキーマを後から変えても、既存項目の作り直しは raw_output からできる。
 */
export const extractions = pgTable(
  'extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specDocumentId: uuid('spec_document_id')
      .notNull()
      .references(() => specDocuments.id, { onDelete: 'cascade' }),
    modelIdUsed: text('model_id_used').notNull(),
    rawOutput: jsonb('raw_output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    succeeded: boolean('succeeded').notNull(),
    error: text('error'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('extractions_document_id_idx').on(t.specDocumentId)],
);

/**
 * 承認キュー。
 *
 * unique(spec_document_id, kind, target_key) が冪等性の要である。
 * neon-http にトランザクションが無いため、cronの重複起動や再実行で
 * 同じ変更が二重に積まれるのを制約で防ぐ（設計書5.4）。
 */
export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    specDocumentId: uuid('spec_document_id')
      .notNull()
      .references(() => specDocuments.id, { onDelete: 'cascade' }),
    kind: changeKindEnum('kind').notNull(),
    /** 適用対象を一意に指す文字列。グレードなら型式、無ければ 名前/パワートレイン/駆動方式 */
    targetKey: text('target_key').notNull(),
    /** 適用前後の値。ロールバックは これを逆適用する */
    diff: jsonb('diff').notNull(),
    /**
     * diff の内容を正規化して取ったハッシュ（pipeline/diff.ts の diffHash）。
     *
     * 一意制約に含める。(書類, 種別, 対象) だけで縛ると、同じグレードに対する
     * 「別の内容の変更」を積めない。実際、装備を取り込んだあとに寸法・出力を
     * 足そうとしたとき、既存の spec_change 行と衝突して再取り込みできなかった。
     * 直すには適用済みの監査記録を消すしかなく、項目を増やすたびに同じことが起きる。
     *
     * 内容まで見れば、同じ内容の二度押しは今までどおり弾き、違う内容は積める。
     * 移行前からある行は 'legacy' が入っている。
     */
    diffHash: text('diff_hash').notNull().default('legacy'),
    status: changeStatusEnum('status').notNull().default('pending'),
    /**
     * 自動承認しなかった理由（decideApproval の reason）。判定した収集スクリプトが
     * その場で書き残す。後から decideApproval を呼び直して復元すると、判定が見る
     * 「その諸元表のグレード総数」が当時の値ではなくなっており、実際に人間へ
     * 回された理由とずれるため。自動承認された行は null。
     */
    reason: text('reason'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('change_requests_document_kind_target_diff_key').on(
      t.specDocumentId,
      t.kind,
      t.targetKey,
      t.diffHash,
    ),
    index('change_requests_status_idx').on(t.status),
  ],
);
