/**
 * Non-destructive Conversation Relay upgrade probe.
 * Does not enable CLAIRE_TWILIO_CONVERSATION_RELAY and does not send a Claire token.
 * Prints host, status, and whether the response was 101. Does not print a URL with a query.
 */
import tls from "node:tls";
const hosts = [
  process.env.CLAIRE_PUBLIC_HOST || "admin.bldg.chat",
  process.env.CLAIRE_RAILWAY_HOST || "bldg-admin-api-production.up.railway.app",
];
const path = "/api/claire/twilio/conversation-relay";

for (const host of hosts) {
  const result = await probe(host, path);
  console.log(JSON.stringify({ host, path, ...result }));
}

async function probe(host, path) {
  const socket = await connectTls(host);
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  socket.write(
    `GET ${path} HTTP/1.1\r\n` +
      `Host: ${host}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${key}\r\n` +
      "Sec-WebSocket-Version: 13\r\n\r\n"
  );
  const header = await readHeader(socket);
  socket.destroy();
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d+)/.exec(header)?.[1] ?? null;
  return {
    status: status ? Number(status) : null,
    switchingProtocols: status === "101",
    contentType: /content-type:\s*([^\r\n]+)/i.exec(header)?.[1] ?? null,
  };
}

function connectTls(host) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 443, servername: host }, () => resolve(socket));
    socket.setTimeout(12_000, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
    socket.on("error", reject);
  });
}

function readHeader(socket) {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timeout"));
    }, 12_000);
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      if (data.includes("\r\n\r\n") || data.length > 4096) {
        clearTimeout(timer);
        resolve(data.toString("utf8").split("\r\n\r\n")[0] ?? "");
      }
    });
    socket.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(data.toString("utf8"));
    });
  });
}
