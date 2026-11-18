// Supabase REST (PostgREST) returns at most 1,000 rows per request.
// These helpers keep a list or a count correct past that cap.

export const PAGE_SIZE = 1000;

/**
 * Keeps asking for the next 1,000 rows until a short page comes back.
 * The query must have a stable order (for example .order('id')) so pages don't overlap.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return out;
  }
}

/** Splits a long id list so each .in() filter stays a reasonable URL length. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Reads the exact count from a { count: 'exact', head: true } request, throwing on error. */
export async function exactCount(request: PromiseLike<{ count: number | null; error: any }>): Promise<number> {
  const { count, error } = await request;
  if (error) throw error;
  return count ?? 0;
}
