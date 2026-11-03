import type { MutationCtx, QueryCtx } from "../../../convex/_generated/server";

/**
 * Minimal in-memory stand-in for a Convex database context. It supports the
 * subset of the query builder used by the migration functions: `withIndex`
 * with `eq` ranges, `collect`, `unique`, `first`, `take`, `order`, `paginate`,
 * plus `insert`, `patch`, and `get`. It exists so tests can execute the real
 * migration handlers instead of mocking them.
 */
type Row = Record<string, unknown> & { _id: string; _creationTime: number };

export class FakeConvexDb {
  private readonly tables = new Map<string, Row[]>();
  private sequence = 0;

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  insert(table: string, document: Record<string, unknown>): string {
    const list = this.tables.get(table) ?? [];
    this.sequence += 1;
    const id = `${table}:${this.sequence}`;
    list.push({ ...document, _id: id, _creationTime: this.sequence });
    this.tables.set(table, list);
    return id;
  }

  patch(id: string, patch: Record<string, unknown>): void {
    for (const list of this.tables.values()) {
      const row = list.find((candidate) => candidate._id === id);
      if (row) {
        Object.assign(row, patch);
        return;
      }
    }
    throw new Error(`FakeConvexDb cannot patch unknown document ${id}.`);
  }

  get(id: string): Row | null {
    for (const list of this.tables.values()) {
      const row = list.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }
}

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([field, value]) => row[field] === value);
}

class QueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private direction: "asc" | "desc" = "asc";

  constructor(private readonly db: FakeConvexDb, private readonly table: string) {}

  withIndex(
    _name: string,
    build?: (range: { eq: (field: string, value: unknown) => unknown }) => unknown,
  ) {
    if (build) {
      const range = {
        eq: (field: string, value: unknown) => {
          this.filters.push([field, value]);
          return range;
        },
      };
      build(range);
    }
    return this;
  }

  order(direction: "asc" | "desc") {
    this.direction = direction;
    return this;
  }

  private result(): Row[] {
    const rows = this.db.rows(this.table).filter((row) => matches(row, this.filters));
    return [...rows].sort((left, right) => {
      const comparison = left._id.localeCompare(right._id);
      return this.direction === "asc" ? comparison : -comparison;
    });
  }

  async collect(): Promise<Row[]> {
    return this.result();
  }

  async take(limit: number): Promise<Row[]> {
    return this.result().slice(0, limit);
  }

  async first(): Promise<Row | null> {
    return this.result()[0] ?? null;
  }

  async unique(): Promise<Row | null> {
    const rows = this.result();
    if (rows.length > 1) throw new Error("FakeConvexDb unique() found more than one document.");
    return rows[0] ?? null;
  }

  async paginate(options: { numItems: number; cursor: string | null }) {
    const all = this.result();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = all.slice(start, start + options.numItems);
    const next = start + page.length;
    const isDone = next >= all.length;
    return { page, isDone, continueCursor: isDone ? "" : String(next) };
  }
}

export function fakeConvexCtx(db: FakeConvexDb): MutationCtx & QueryCtx {
  return {
    db: {
      query: (table: string) => new QueryBuilder(db, table),
      insert: (table: string, document: Record<string, unknown>) => db.insert(table, document),
      patch: (id: string, patch: Record<string, unknown>) => db.patch(id, patch),
      get: (id: string) => db.get(id),
    },
  } as unknown as MutationCtx & QueryCtx;
}
