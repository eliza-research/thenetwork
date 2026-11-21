// spec/outboundAdmission.md, "A claim needs the Network state that its checks read"
// The version (network.network_state xmin) of the Network state that a runtime holds in memory. The queue's stale
// and recipient checks read that copy, so a drain and a claim need it to be the stored version.
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { viewPolicy } from "../../core/src/generated/outboundAdmission.ts";

export class StateView {
  /** The version that the last load read; the copy takes it only when it is imported unchanged or saved. */
  private loaded = "";
  /** The version of the copy in memory; "" while it is not known (a unit loaded it and did not save). */
  private current = "";

  constructor(private readonly id: string) {}

  private async stored(db: SQL): Promise<string> {
    const [row] = await db`select xmin::text as version from network.network_state where id = ${this.id}`;
    return row ? String(row.version) : "none";
  }

  /** Under the Network lock, right after the state was read and before it is imported. */
  async load(db: SQL): Promise<void> {
    this.current = "";
    this.loaded = await this.stored(db);
  }

  /** The loaded state is in memory unchanged. */
  imported(): void {
    this.current = this.loaded;
  }

  /** Under the Network lock, right after the save committed. */
  async saved(db: SQL): Promise<void> {
    this.current = await this.stored(db);
  }

  async isCurrent(db: SQL): Promise<boolean> {
    return viewPolicy(await this.stored(db), this.current) === "ViewCurrent";
  }
}
