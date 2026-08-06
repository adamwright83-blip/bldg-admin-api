// Preconfigured storage helpers for Manus WebDev templates
// Uses the Biz-provided storage proxy (Authorization: Bearer <token>)

import { ENV } from "./_core/env";
import { eq, sql } from "drizzle-orm";
import { privateStorageObjects } from "../drizzle/schema";
import { getDb } from "./db";

type StorageConfig = { baseUrl: string; apiKey: string };

function getStorageConfig(): StorageConfig | null {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;

  if (!baseUrl || !apiKey) return null;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

let privateStorageReady: Promise<void> | null = null;

async function ensurePrivateStorageTable(): Promise<void> {
  if (privateStorageReady) return privateStorageReady;
  privateStorageReady = (async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available for private storage");
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS private_storage_objects (
        storageKey varchar(512) NOT NULL,
        contentType varchar(191) NOT NULL,
        data longblob NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT private_storage_objects_storageKey PRIMARY KEY (storageKey)
      )
    `));
  })().catch(error => {
    privateStorageReady = null;
    throw error;
  });
  return privateStorageReady;
}

async function databaseStoragePut(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string
): Promise<{ key: string; url: string }> {
  await ensurePrivateStorageTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available for private storage");
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  await db
    .insert(privateStorageObjects)
    .values({ storageKey: key, contentType, data: bytes })
    .onDuplicateKeyUpdate({ set: { contentType, data: bytes } });
  return { key, url: `private-db://${encodeURIComponent(key)}` };
}

async function databaseStorageGet(key: string): Promise<{ key: string; url: string }> {
  await ensurePrivateStorageTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available for private storage");
  const [object] = await db
    .select()
    .from(privateStorageObjects)
    .where(eq(privateStorageObjects.storageKey, key))
    .limit(1);
  if (!object) throw new Error("Private storage object not found");
  return {
    key,
    url: `data:${object.contentType};base64,${Buffer.from(object.data).toString("base64")}`,
  };
}

async function databaseStorageDelete(key: string): Promise<{ key: string }> {
  await ensurePrivateStorageTable();
  const db = await getDb();
  if (!db) throw new Error("Database not available for private storage");
  await db
    .delete(privateStorageObjects)
    .where(eq(privateStorageObjects.storageKey, key));
  return { key };
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

function buildDeleteUrl(baseUrl: string, relKey: string): URL {
  const url = new URL("v1/storage/delete", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(
  baseUrl: string,
  relKey: string,
  apiKey: string
): Promise<string> {
  const downloadApiUrl = new URL(
    "v1/storage/downloadUrl",
    ensureTrailingSlash(baseUrl)
  );
  downloadApiUrl.searchParams.set("path", normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, {
    method: "GET",
    headers: buildAuthHeaders(apiKey),
  });
  return (await response.json()).url;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function toFormData(
  data: Buffer | Uint8Array | string,
  contentType: string,
  fileName: string
): FormData {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const config = getStorageConfig();
  if (!config) return databaseStoragePut(key, data, contentType);
  const { baseUrl, apiKey } = config;
  const uploadUrl = buildUploadUrl(baseUrl, key);
  const formData = toFormData(data, contentType, key.split("/").pop() ?? key);
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: buildAuthHeaders(apiKey),
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage upload failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const config = getStorageConfig();
  if (!config) return databaseStorageGet(key);
  const { baseUrl, apiKey } = config;
  return {
    key,
    url: await buildDownloadUrl(baseUrl, key, apiKey),
  };
}

/**
 * Deletes a private object through the same authenticated storage proxy used
 * for upload/download. Any non-2xx response fails closed so retention never
 * removes the authoritative database row unless object deletion succeeded.
 */
export async function storageDelete(relKey: string): Promise<{ key: string }> {
  const key = normalizeKey(relKey);
  if (!key) throw new Error("Storage deletion requires a non-empty object key");
  const config = getStorageConfig();
  if (!config) return databaseStorageDelete(key);
  const { baseUrl, apiKey } = config;
  const response = await fetch(buildDeleteUrl(baseUrl, key), {
    method: "DELETE",
    headers: buildAuthHeaders(apiKey),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(
      `Storage deletion failed (${response.status} ${response.statusText}): ${message}`
    );
  }
  return { key };
}
