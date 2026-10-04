import { createHash } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { MitchEvent } from "../../shared/mitchEvents";

export interface IMitchEventInbox {
  put(event: MitchEvent): Promise<boolean>;
  bindDelivery(deliveryId: string, eventId: string): Promise<void>;
  process(
    eventId: string,
    apply: (event: MitchEvent) => Promise<void>
  ): Promise<boolean>;
  pending(): Promise<string[]>;
}
function fingerprint(event: MitchEvent): string {
  // Schema parsing normalizes field order before persistence.
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}
export class MemoryMitchEventInbox implements IMitchEventInbox {
  private deliveries = new Map<string, string>();
  async bindDelivery(deliveryId: string, eventId: string) {
    const previous = this.deliveries.get(deliveryId);
    if (previous && previous !== eventId)
      throw new Error("Delivery ID reused for a different event");
    this.deliveries.set(deliveryId, eventId);
  }
  rows = new Map<string, { event: MitchEvent; hash: string; status: string }>();
  async put(event: MitchEvent) {
    const row = this.rows.get(event.eventId);
    if (row) {
      if (row.hash !== fingerprint(event))
        throw new Error("Event ID reused with different payload");
      return false;
    }
    this.rows.set(event.eventId, {
      event,
      hash: fingerprint(event),
      status: "pending",
    });
    return true;
  }
  async process(id: string, apply: (event: MitchEvent) => Promise<void>) {
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return false;
    row.status = "processing";
    try {
      await apply(row.event);
      row.status = "done";
    } catch (error) {
      row.status = "dead_letter";
      throw error;
    }
    return true;
  }
  async pending() {
    return [...this.rows]
      .filter(([, row]) => row.status === "pending")
      .map(([id]) => id);
  }
}
/** A database lock serializes production changes across worker replicas. Ambiguous
 * partial failures are quarantined, never blindly replayed into nontransactional services. */
export class MysqlMitchEventInbox implements IMitchEventInbox {
  constructor(private readonly pool: Pool) {}
  async bindDelivery(deliveryId: string, eventId: string) {
    await this.pool.execute(
      "INSERT IGNORE INTO mitch_producer_deliveries (delivery_id, event_id) VALUES (?, ?)",
      [deliveryId, eventId]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT event_id FROM mitch_producer_deliveries WHERE delivery_id = ?",
      [deliveryId]
    );
    if (rows[0]?.event_id !== eventId)
      throw new Error("Delivery ID reused for a different event");
  }
  async put(event: MitchEvent) {
    const [result] = await this.pool.execute<any>(
      "INSERT IGNORE INTO mitch_producer_events (event_id, payload_hash, payload_json, status) VALUES (?, ?, ?, 'pending')",
      [event.eventId, fingerprint(event), JSON.stringify(event)]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT payload_hash FROM mitch_producer_events WHERE event_id = ?",
      [event.eventId]
    );
    if (rows[0]?.payload_hash !== fingerprint(event))
      throw new Error("Event ID reused with different payload");
    return result.affectedRows === 1;
  }
  async process(id: string, apply: (event: MitchEvent) => Promise<void>) {
    const connection = await this.pool.getConnection();
    let locked = false;
    try {
      const [locks] = await connection.execute<RowDataPacket[]>(
        "SELECT GET_LOCK('mitch-producer-events-v1', 30) AS acquired"
      );
      locked = Number(locks[0].acquired) === 1;
      if (!locked) return false;
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT payload_json, status FROM mitch_producer_events WHERE event_id = ?",
        [id]
      );
      if (!rows[0] || rows[0].status !== "pending") return false;
      await connection.execute(
        "UPDATE mitch_producer_events SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE event_id = ?",
        [id]
      );
      try {
        const payload = rows[0].payload_json;
        await apply(
          typeof payload === "string" ? JSON.parse(payload) : payload
        );
        await connection.execute(
          "UPDATE mitch_producer_events SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE event_id = ?",
          [id]
        );
      } catch (error) {
        await connection.execute(
          "UPDATE mitch_producer_events SET status = 'dead_letter', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE event_id = ?",
          [String(error).slice(0, 2000), id]
        );
        throw error;
      }
      return true;
    } finally {
      if (locked)
        await connection.execute(
          "SELECT RELEASE_LOCK('mitch-producer-events-v1')"
        );
      connection.release();
    }
  }
  async pending() {
    // A crashed processing attempt has unknown side effects; make it inspectable.
    await this.pool.execute(
      "UPDATE mitch_producer_events SET status = 'dead_letter', last_error = 'Interrupted processing; reconcile durable production state before replay' WHERE status = 'processing' AND updated_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)"
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT event_id FROM mitch_producer_events WHERE status = 'pending' ORDER BY created_at LIMIT 100"
    );
    return rows.map(row => String(row.event_id));
  }
}
