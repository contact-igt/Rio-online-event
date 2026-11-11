import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config, R2Config } from "../config.ts";

// The private Cloudflare R2 bucket, through its S3-compatible API. Server-only: the access key never leaves this process, and the bucket has
// no public domain. A browser touches it only through a presigned URL that expires in minutes: a PUT to pending/<id> for a parent's upload,
// a GET of videos/<id> for a signed-in judge. Ported from website/lib/storage/object-store.ts (tested there against the real bucket on
// 2026-11-06, brief section 26).
//
// Objects are named by random ids only. An upload lands under pending/<id>; once the server has checked it, it is copied to videos/<id>. So
// the upload URL (a bearer credential until it expires) can never overwrite a checked video: it only reaches pending/, which a lifecycle rule
// empties daily.

export type ObjectHead = { bytes: number; contentType: string | null; etag: string | null };

export type VideoStore = {
  /** A URL the browser can PUT one object to, signed for this exact Content-Type. */
  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): Promise<string>;
  /** A URL a browser can GET one object from, shown inline. The caller has already checked who is asking. */
  presignGet(key: string, opts: { expiresInSeconds: number }): Promise<string>;
  /** Size, type and ETag of a stored object, or null if there is none. */
  head(key: string): Promise<ObjectHead | null>;
  /** Server-side copy that succeeds only if the source is still the object with this ETag. */
  copy(fromKey: string, toKey: string, ifMatchEtag: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Bytes start..endInclusive of an object (a ranged GET), never the whole file. Used to check a video's container and declared length. */
  readRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;
};

export const pendingKey = (id: string) => `pending/${id}`;
export const videoKey = (id: string) => `videos/${id}`;

function createClient(cfg: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true, // one host per account, so the website's connect-src needs a single entry
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // R2 does not accept the SDK's default CRC32 checksum on a presigned PUT; compute checksums only when required
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const isMissing = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

export function createR2Store(cfg: R2Config, client: S3Client = createClient(cfg)): VideoStore {
  const Bucket = cfg.bucket;
  return {
    presignPut: (key, { contentType, expiresInSeconds }) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(["content-type"]), // the PUT must carry exactly this Content-Type
      }),
    presignGet: (key, { expiresInSeconds }) =>
      getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: "inline" }), { expiresIn: expiresInSeconds }),
    async head(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { bytes: r.ContentLength ?? 0, contentType: r.ContentType ?? null, etag: r.ETag ?? null };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async copy(fromKey, toKey, ifMatchEtag) {
      await client.send(new CopyObjectCommand({ Bucket, Key: toKey, CopySource: `${Bucket}/${fromKey}`, CopySourceIfMatch: ifMatchEtag }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key })); // deleting a missing key is not an error in S3
    },
    async readRange(key, start, endInclusive) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${endInclusive}` }));
      return (await r.Body?.transformToByteArray()) ?? new Uint8Array();
    },
  };
}

/** The bucket, or null when it is not configured. Judge playback needs only this; parent uploads also need RIO_UPLOADS_ENABLED=yes. */
export function videoStoreFor(config: Config): VideoStore | null {
  return config.uploads.r2 ? createR2Store(config.uploads.r2) : null;
}
