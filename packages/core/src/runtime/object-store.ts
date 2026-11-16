import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { nodeReadable } from "./streams.ts";

type Settings = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };

export class ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region }: Settings) {
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async write(key: string, value: string | Uint8Array | Blob, options?: { type?: string }) {
    const content = value instanceof Blob ? nodeReadable(value.stream()) : value;
    const length = value instanceof Blob ? value.size : typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
    const params = { Bucket: this.bucket, Key: key, Body: content, ContentType: options?.type, ContentLength: length };
    if (value instanceof Blob && value.size > 8 * 1024 * 1024) {
      await new Upload({ client: this.client, params, partSize: 8 * 1024 * 1024 }).done();
    } else await this.client.send(new PutObjectCommand(params));
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private async body(key: string) {
    const { Body } = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!Body) throw new Error("Object store returned an empty response");
    return Body;
  }

  async stream(key: string) { return (await this.body(key)).transformToWebStream(); }

  file(key: string) {
    return {
      text: async () => (await this.body(key)).transformToString(),
      arrayBuffer: async () => Uint8Array.from(await (await this.body(key)).transformToByteArray()).buffer,
    };
  }

  async list({ prefix, startAfter }: { prefix: string; startAfter?: string }) {
    const result = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket, Prefix: prefix, StartAfter: startAfter,
    }));
    return {
      contents: result.Contents?.flatMap(object => object.Key === undefined ? [] : [{ key: object.Key }]) ?? [],
      isTruncated: result.IsTruncated ?? false,
    };
  }
}
