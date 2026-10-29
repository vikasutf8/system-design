/**
 * Maps a MongoDB catalog document (or a Debezium-unwrapped change event) to
 * the Elasticsearch document from arch.md 5.7.
 *
 * snake_case is used only at the index boundary; the source of truth stays
 * camelCase in MongoDB.
 */
export function toBookDocument(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    book_id: String(raw._id ?? raw.book_id ?? raw.bookId ?? ''),
    title: raw.title ?? '',
    authors: asStringArray(raw.authors),
    isbn: raw.isbn ?? '',
    genres: asStringArray(raw.genres),
    language: raw.language ?? '',
    publication_year: toInteger(raw.publicationYear ?? raw.publication_year),
    tags: asStringArray(raw.tags),
    description: raw.description ?? '',
    updated_at: toIsoDate(raw.updatedAt ?? raw.updated_at),
  };
}

/** External versioning source: Debezium ts_ms when present, else updatedAt. */
export function changeVersion(raw: Record<string, unknown>): number {
  const changeTs = Number(raw.__ts_ms);
  if (Number.isFinite(changeTs) && changeTs > 0) return changeTs;
  const updatedAt = toDate(raw.updatedAt ?? raw.updated_at);
  return updatedAt?.getTime() ?? Date.now();
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === null || value === undefined) return [];
  return [String(value)];
}

function toInteger(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function toIsoDate(value: unknown): string | undefined {
  return toDate(value)?.toISOString();
}

/**
 * Debezium's JSON converter can emit Mongo dates as ISO strings or epoch
 * millis depending on configuration, so accept both forms.
 */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const asString = String(value);
  const parsed = Date.parse(asString);
  if (Number.isFinite(parsed)) return new Date(parsed);
  const asNumber = Number(asString);
  if (Number.isFinite(asNumber)) {
    const date = new Date(asNumber);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}
