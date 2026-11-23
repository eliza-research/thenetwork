import type { SQL } from "../../core/src/runtime/postgres.ts";
import { viewPolicy } from "../../core/src/generated/outboundAdmission.ts";

export class StateView {
  private loaded = "";
  private current = "";

  constructor(private readonly id: string) {}

  private async stored(db: SQL): Promise<string> {
    const [row] = await db`select xmin::text as version from network.network_state where id = ${this.id}`;
    return row ? String(row.version) : "none";
  }

  async load(db: SQL): Promise<void> {
    this.current = "";
    this.loaded = await this.stored(db);
  }

  imported(): void {
    this.current = this.loaded;
  }

  async saved(db: SQL): Promise<void> {
    this.current = await this.stored(db);
  }

  async isCurrent(db: SQL): Promise<boolean> {
    return viewPolicy(await this.stored(db), this.current) === "ViewCurrent";
  }
}
