import postgres from "postgres";

type ConnectionOptions = Omit<postgres.Options<{}>, "connection"> & {
  url?: string;
  idleTimeout?: number;
  connectionTimeout?: number;
  connection?: Record<string, string | number | boolean>;
};
type Driver = postgres.Sql | postgres.TransactionSql | postgres.ReservedSql;
type ArrayElement = "TEXT" | "text" | "int8";

export interface SQL extends Omit<postgres.Sql, "array" | "begin" | "reserve"> {
  <T extends readonly (object | undefined)[] = any[]>(strings: TemplateStringsArray, ...values: any[]): postgres.PendingQuery<T>;
  (values: unknown, ...keys: readonly unknown[]): any;
  array(values: readonly unknown[], element: ArrayElement): ReturnType<postgres.Sql["typed"]>;
  begin<T>(action: (transaction: SQL) => T | Promise<T>): Promise<T>;
  reserve(): Promise<SQL & { release(): void }>;
}

function connection(handle: Driver): SQL {
  return new Proxy(handle, {
    get(target, property, receiver) {
      if (property === "array") {
        return (values: readonly unknown[], element: ArrayElement) => target.typed(values, element === "int8" ? 1016 : 1009);
      }
      if (property === "begin" && "begin" in target) {
        return <T>(action: (transaction: SQL) => T | Promise<T>) => target.begin(tx => action(connection(tx)));
      }
      if (property === "reserve" && "reserve" in target) {
        return async () => connection(await target.reserve());
      }
      if (property === "close" && "end" in target) return () => target.end();
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as SQL;
}

/** Open a PostgreSQL pool for the shared tagged-template queries. */
function open(input: string | ConnectionOptions): SQL {
  const onnotice = () => {};
  if (typeof input === "string") return connection(postgres(input, { onnotice }));
  const { url, idleTimeout, connectionTimeout, ...options } = input;
  const settings = {
    onnotice,
    ...options,
    ...(idleTimeout !== undefined ? { idle_timeout: idleTimeout } : {}),
    ...(connectionTimeout !== undefined ? { connect_timeout: connectionTimeout } : {}),
  } as postgres.Options<{}>;
  return connection(url === undefined ? postgres(settings) : postgres(url, settings));
}

export const SQL = function SQL(input: string | ConnectionOptions) { return open(input); } as unknown as {
  new (input: string | ConnectionOptions): SQL;
};
