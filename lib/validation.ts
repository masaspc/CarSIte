import { z } from 'zod';
import { FEATURE_COLUMNS } from '@/db/schema';

const YYYY_MM = /^\d{4}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const featureValue = z.enum(['standard', 'option', 'none', 'unknown']).default('unknown');

const featureFields = Object.fromEntries(
  FEATURE_COLUMNS.map((column) => [column, featureValue]),
) as Record<(typeof FEATURE_COLUMNS)[number], typeof featureValue>;

export const gradeInputSchema = z
  .object({
    modelId: z.uuid(),
    name: z.string().min(1).max(60),
    slug: z.string().regex(SLUG, 'slug は小文字英数字とハイフンのみ'),
    price: z.number().int().min(0).max(100_000_000),
    releaseDate: z.string().regex(YYYY_MM, 'YYYY-MM 形式で入力してください').nullish(),
    discontinuedAt: z.string().regex(YYYY_MM).nullish(),
    engineType: z.enum(['ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV']),
    driveSystem: z.enum(['FF', 'FR', '4WD', 'MR', 'RR']),
    transmission: z.string().max(40).nullish(),
    seating: z.number().int().min(1).max(12),
    displacement: z.number().int().min(0).max(10_000).nullish(),
    weight: z.number().int().min(0).max(5_000).nullish(),
    wltcMode: z.number().min(0).max(100).nullish(),
    cruisingRange: z.number().int().min(0).max(2_000).nullish(),
    ecoCarTax: z.boolean().default(false),
    airbags: z.number().int().min(0).max(20).nullish(),
    ...featureFields,
  })
  .strip();

export type GradeInput = z.infer<typeof gradeInputSchema>;
