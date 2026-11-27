import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { escapeXml, md5Hex, type ServiceContext, type ServiceResult } from "../http-helpers.ts";
import type { S3StoredObject } from "../state.ts";

function s3XmlError(code: string, message: string, resource: string, status: number): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message><Resource>${escapeXml(resource)}</Resource></Error>`;
  return new Response(xml, {
    status,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function getBucket(ctx: ServiceContext, bucket: string): Map<string, S3StoredObject> {
  let map = ctx.state.s3Buckets.get(bucket);
  if (!map) {
    map = new Map();
    ctx.state.s3Buckets.set(bucket, map);
  }
  return map;
}

function safeDirSegment(raw: string): string | null {
  if (!raw || raw.includes("\0") || raw.includes("/") || raw.includes("\\")) return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) return null;
  return cleaned;
}

function mirrorToDisk(ctx: ServiceContext, bucket: string, key: string, body: Uint8Array | null): void {
  if (!ctx.registry.s3Dir) return;
  const safeSession = safeDirSegment(ctx.state.sessionId);
  const safeBucket = safeDirSegment(bucket);
  if (!safeSession || !safeBucket) return;
  if (!key || key.includes("\0") || key.startsWith("/") || key.includes("\\")) return;
  const keySegments = key.split("/");
  if (keySegments.some((seg) => seg === "" || seg === "." || seg === "..")) return;

  const baseDir = resolve(ctx.registry.s3Dir);
  const root = resolve(baseDir, safeSession, safeBucket);
  if (!root.startsWith(`${baseDir}${sep}`)) return;
  const full = resolve(root, key);
  if (!full.startsWith(`${root}${sep}`)) return;

  if (body === null) {
    try {
      rmSync(full, { force: true });
    } catch {
    }
    return;
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function decodeKeyPath(raw: string): string {
  return raw
    .split("/")
    .map((seg) => decodeURIComponent(seg))
    .join("/");
}

export async function handleS3Request(
  ctx: ServiceContext,
  req: Request,
  url: URL,
): Promise<ServiceResult | null> {
  if (!url.pathname.startsWith("/s3/")) return null;
  const rest = url.pathname.slice("/s3/".length);
  const slashIdx = rest.indexOf("/");
  const bucket = decodeURIComponent(slashIdx < 0 ? rest : rest.slice(0, slashIdx));
  const rawKey = slashIdx < 0 ? "" : rest.slice(slashIdx + 1);
  const key = rawKey ? decodeKeyPath(rawKey) : "";

  if (!bucket) {
    return {
      service: "s3",
      response: s3XmlError("InvalidBucketName", "Bucket name is required", url.pathname, 400),
    };
  }

  const nowIso = ctx.registry.clock.iso();

  if (req.method === "GET" && (!key || url.searchParams.get("list-type") === "2")) {
    const store = getBucket(ctx, bucket);
    const prefix = url.searchParams.get("prefix") ?? "";
    const startAfter = url.searchParams.get("start-after") ?? url.searchParams.get("continuation-token") ?? "";
    const maxKeys = Math.max(1, Math.min(1000, Number(url.searchParams.get("max-keys") ?? 1000) || 1000));

    const matchedKeys = [...store.keys()]
      .filter((k) => k.startsWith(prefix) && (!startAfter || k > startAfter))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const isTruncated = matchedKeys.length > maxKeys;
    const pageKeys = matchedKeys.slice(0, maxKeys);
    const nextToken = isTruncated ? pageKeys[pageKeys.length - 1] ?? "" : "";

    const contentsXml = pageKeys
      .map((k) => {
        const obj = store.get(k)!;
        return `<Contents><Key>${escapeXml(obj.key)}</Key><LastModified>${escapeXml(obj.lastModifiedIso)}</LastModified><ETag>${escapeXml(obj.etag)}</ETag><Size>${obj.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join("");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${escapeXml(bucket)}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${pageKeys.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys><IsTruncated>${isTruncated ? "true" : "false"}</IsTruncated>${nextToken ? `<NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : ""}${contentsXml}</ListBucketResult>`;
    return {
      service: "s3",
      response: new Response(xml, {
        status: 200,
        headers: { "content-type": "application/xml; charset=utf-8" },
      }),
      requestSummary: { bucket, prefix, startAfter, maxKeys },
      responseSummary: { keyCount: pageKeys.length, isTruncated },
    };
  }

  if (req.method === "POST" && url.searchParams.has("uploads") && key) {
    const uploadId = ctx.registry.nextId(ctx.state, "mpu");
    ctx.state.s3Multiparts.set(uploadId, {
      uploadId,
      bucket,
      key,
      contentType: req.headers.get("content-type") ?? "application/octet-stream",
      parts: new Map(),
      initiatedAtMs: ctx.registry.clock.now(),
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${escapeXml(uploadId)}</UploadId></InitiateMultipartUploadResult>`;
    return {
      service: "s3",
      response: new Response(xml, { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } }),
      requestSummary: { bucket, key, action: "initiate_multipart" },
      responseSummary: { uploadId },
    };
  }

  const uploadId = url.searchParams.get("uploadId");
  const partNumberRaw = url.searchParams.get("partNumber");

  if (req.method === "PUT" && uploadId && partNumberRaw && key) {
    const mpu = ctx.state.s3Multiparts.get(uploadId);
    if (!mpu || mpu.bucket !== bucket || mpu.key !== key) {
      return { service: "s3", response: s3XmlError("NoSuchUpload", "The specified upload does not exist.", url.pathname, 404) };
    }
    const partNumber = Number.parseInt(partNumberRaw, 10);
    const bytes = new Uint8Array(await req.arrayBuffer());
    const etag = `"${md5Hex(bytes)}"`;
    mpu.parts.set(partNumber, { etag, body: bytes });
    return {
      service: "s3",
      response: new Response(null, { status: 200, headers: { etag } }),
      requestSummary: { bucket, key, uploadId, partNumber, bytes: bytes.byteLength },
      responseSummary: { etag },
    };
  }

  if (req.method === "POST" && uploadId && key) {
    const mpu = ctx.state.s3Multiparts.get(uploadId);
    if (!mpu || mpu.bucket !== bucket || mpu.key !== key) {
      return { service: "s3", response: s3XmlError("NoSuchUpload", "The specified upload does not exist.", url.pathname, 404) };
    }
    const orderedParts = [...mpu.parts.entries()].sort((a, b) => a[0] - b[0]);
    const totalLen = orderedParts.reduce((acc, [, part]) => acc + part.body.byteLength, 0);
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const [, part] of orderedParts) {
      merged.set(part.body, offset);
      offset += part.body.byteLength;
    }
    const etag = `"${md5Hex(merged)}-${orderedParts.length}"`;
    const stored: S3StoredObject = {
      key,
      body: merged,
      etag,
      contentType: mpu.contentType,
      lastModifiedIso: nowIso,
    };
    getBucket(ctx, bucket).set(key, stored);
    ctx.state.s3Multiparts.delete(uploadId);
    mirrorToDisk(ctx, bucket, key, merged);

    const location = `${ctx.baseUrl}/s3/${encodeURIComponent(bucket)}/${key}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CompleteMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Location>${escapeXml(location)}</Location><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><ETag>${escapeXml(etag)}</ETag></CompleteMultipartUploadResult>`;
    return {
      service: "s3",
      response: new Response(xml, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", etag } }),
      requestSummary: { bucket, key, uploadId, parts: orderedParts.length },
      responseSummary: { bytes: merged.byteLength, etag },
    };
  }

  if (req.method === "DELETE" && uploadId && key) {
    ctx.state.s3Multiparts.delete(uploadId);
    return { service: "s3", response: new Response(null, { status: 204 }), requestSummary: { bucket, key, uploadId, action: "abort_multipart" } };
  }

  if (req.method === "PUT" && key) {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const etag = `"${md5Hex(bytes)}"`;
    const contentType = req.headers.get("content-type") ?? "application/octet-stream";
    const stored: S3StoredObject = {
      key,
      body: bytes,
      etag,
      contentType,
      lastModifiedIso: nowIso,
    };
    getBucket(ctx, bucket).set(key, stored);
    mirrorToDisk(ctx, bucket, key, bytes);
    return {
      service: "s3",
      response: new Response(null, { status: 200, headers: { etag } }),
      requestSummary: { bucket, key, bytes: bytes.byteLength, contentType },
      responseSummary: { etag },
    };
  }

  if ((req.method === "GET" || req.method === "HEAD") && key) {
    const obj = getBucket(ctx, bucket).get(key);
    if (!obj) {
      return {
        service: "s3",
        response: s3XmlError("NoSuchKey", "The specified key does not exist.", join(bucket, key), 404),
        requestSummary: { bucket, key },
        responseSummary: { found: false },
      };
    }
    const headers: Record<string, string> = {
      "content-type": obj.contentType,
      "content-length": String(obj.body.byteLength),
      etag: obj.etag,
      "last-modified": new Date(obj.lastModifiedIso).toUTCString(),
    };
    const bodyCopy = req.method === "HEAD" ? null : new Uint8Array(obj.body);
    return {
      service: "s3",
      response: new Response(bodyCopy, { status: 200, headers }),
      requestSummary: { bucket, key },
      responseSummary: { bytes: obj.body.byteLength, etag: obj.etag },
    };
  }

  if (req.method === "DELETE" && key) {
    const existed = getBucket(ctx, bucket).delete(key);
    mirrorToDisk(ctx, bucket, key, null);
    return {
      service: "s3",
      response: new Response(null, { status: 204 }),
      requestSummary: { bucket, key },
      responseSummary: { deleted: existed },
    };
  }

  return {
    service: "s3",
    response: s3XmlError("MethodNotAllowed", `Unsupported S3 method ${req.method}`, url.pathname, 405),
  };
}
