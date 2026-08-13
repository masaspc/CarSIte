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

export const bodyTypeEnum = pgEnum('body_type', [
  '軽自動車', 'コンパクトカー', 'セダン', 'ハッチバック',
  'ステーションワゴン', 'SUV', 'ミニバン', 'スポーツカー', 'クーペ',
]);
export const engineTypeEnum = pgEnum('engine_type', [
  'ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV',
]);
export const driveSystemEnum = pgEnum('drive_system', ['FF', 'FR', '4WD', 'MR', 'RR']);
export const transmissionTypeEnum = pgEnum('transmission_type', [
  'CVT', 'AT', 'MT', 'DCT', '電気式無段変速機', 'other',
]);
export const featureAvailabilityEnum = pgEnum('feature_availability', [
  'standard', 'option', 'none', 'unknown',
]);
export const publicationStatusEnum = pgEnum('publication_status', [
  'draft', 'published', 'archived',
]);

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

    sourceUrl: text('source_url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedBy: text('verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('grades_model_name_key').on(t.modelId, t.name),
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
