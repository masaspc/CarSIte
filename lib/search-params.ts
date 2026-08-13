import { FEATURE_COLUMNS, type FeatureColumn } from '@/db/schema';
import type { GradeFilters } from '@/db/queries';

const SORTS = ['price-asc', 'price-desc', 'fuel-desc', 'date-desc', 'date-asc'] as const;
type Sort = (typeof SORTS)[number];

const FEATURE_SET = new Set<string>(FEATURE_COLUMNS);

function positiveNumber(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function positiveInteger(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return undefined;
  return value;
}

export function parseSearchParams(params: URLSearchParams): GradeFilters {
  const filters: GradeFilters = {};

  const keyword = params.get('keyword')?.trim();
  if (keyword) filters.keyword = keyword;

  const manufacturers = params.getAll('manufacturer').filter(Boolean);
  if (manufacturers.length) filters.manufacturers = manufacturers;

  const bodyTypes = params.getAll('bodyType').filter(Boolean);
  if (bodyTypes.length) filters.bodyTypes = bodyTypes;

  const engineTypes = params.getAll('engineType').filter(Boolean);
  if (engineTypes.length) filters.engineTypes = engineTypes;

  const driveSystem = params.get('driveSystem');
  if (driveSystem) filters.driveSystem = driveSystem;

  const priceMin = positiveInteger(params.get('priceMin'));
  if (priceMin !== undefined) filters.priceMin = priceMin;

  const priceMax = positiveInteger(params.get('priceMax'));
  if (priceMax !== undefined) filters.priceMax = priceMax;

  const fuelEfficiencyMin = positiveNumber(params.get('fuelEfficiencyMin'));
  if (fuelEfficiencyMin !== undefined) filters.fuelEfficiencyMin = fuelEfficiencyMin;

  const seatingMin = positiveInteger(params.get('seatingMin'));
  if (seatingMin !== undefined) filters.seatingMin = seatingMin;

  const features = params
    .getAll('feature')
    .filter((f): f is FeatureColumn => FEATURE_SET.has(f));
  if (features.length) filters.features = features;

  const sort = params.get('sort');
  filters.sort = SORTS.includes(sort as Sort) ? (sort as Sort) : 'price-asc';

  const page = Number(params.get('page'));
  if (Number.isFinite(page)) {
    const floored = Math.floor(page);
    filters.page = Math.min(Math.max(floored, 1), 1000);
  } else {
    filters.page = 1;
  }

  return filters;
}

export function buildSearchParams(filters: GradeFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.keyword) params.set('keyword', filters.keyword);
  for (const value of filters.manufacturers ?? []) params.append('manufacturer', value);
  for (const value of filters.bodyTypes ?? []) params.append('bodyType', value);
  for (const value of filters.engineTypes ?? []) params.append('engineType', value);
  if (filters.driveSystem) params.set('driveSystem', filters.driveSystem);
  if (filters.priceMin !== undefined) params.set('priceMin', String(filters.priceMin));
  if (filters.priceMax !== undefined) params.set('priceMax', String(filters.priceMax));
  if (filters.fuelEfficiencyMin !== undefined) {
    params.set('fuelEfficiencyMin', String(filters.fuelEfficiencyMin));
  }
  if (filters.seatingMin !== undefined) params.set('seatingMin', String(filters.seatingMin));
  for (const value of filters.features ?? []) params.append('feature', value);
  if (filters.sort && filters.sort !== 'price-asc') params.set('sort', filters.sort);
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));

  return params;
}
