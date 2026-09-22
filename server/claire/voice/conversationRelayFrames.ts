import { createHash } from "node:crypto";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function websocketAcceptValue(secWebSocketKey: string): string {
  return createHash("sha1").update(`${secWebSocketKey}${WS_GUID}`).digest("base64");
}

export function encodeServerTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  return Buffer.concat([serverFrameHeader(0x1, payload.length), payload]);
}

export function encodeServerCloseFrame(): Buffer {
  return serverFrameHeader(0x8, 0);
}

function serverFrameHeader(opcode: number, length: number): Buffer {
  const first = 0x80 | opcode;
  if (length < 126) return Buffer.from([first, length]);
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = first;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return header;
  }
  const header = Buffer.alloc(10);
  header[0] = first;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return header;
}

export type DecodedSocketFrame = {
  opcode: number;
  payload: Buffer;
};

/**
 * Minimal RFC6455 decoder for Twilio's masked client text frames.
 * Control frames may arrive between text fragments.
 */
export class ConversationRelayFrameDecoder {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private fragments: Buffer<ArrayBufferLike>[] = [];

  push(chunk: Buffer): DecodedSocketFrame[] {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const frames: DecodedSocketFrame[] = [];
    while (this.buffer.length >= 2) {
      const decoded = this.readOne();
      if (!decoded) break;
      if (decoded.opcode === 0x0) {
        this.fragments.push(decoded.payload);
        continue;
      }
      if (decoded.opcode === 0x1 && this.fragments.length) {
        frames.push({
          opcode: 0x1,
          payload: Buffer.concat([...this.fragments, decoded.payload]),
        });
        this.fragments = [];
        continue;
      }
      frames.push(decoded);
    }
    return frames;
  }

  private readOne(): DecodedSocketFrame | null {
    const first = this.buffer[0] ?? 0;
    const second = this.buffer[1] ?? 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (this.buffer.length < 4) return null;
      length = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (this.buffer.length < 10) return null;
      const wide = this.buffer.readBigUInt64BE(2);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      length = Number(wide);
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (this.buffer.length < offset + maskLength + length) return null;
    const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4] ?? 0;
    }
    this.buffer = this.buffer.subarray(offset + length);
    return { opcode, payload };
  }
}
