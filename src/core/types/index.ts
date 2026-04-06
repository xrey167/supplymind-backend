export interface Pagination { page: number; limit: number; total: number; }
export type SortOrder = 'asc' | 'desc';
export interface PaginatedResponse<T> { data: T[]; pagination: Pagination; }
export * from './ids';
