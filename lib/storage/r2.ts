import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireR2 } from '../env';
import type { StorageAdapter } from './index';

let client: S3Client | null = null;

function s3() {
  const cfg = requireR2();
  client ??= new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return { client, cfg };
}

export function r2Storage(): StorageAdapter {
  return {
    name: 'r2',

    async put(key, body, contentType) {
      const { client, cfg } = s3();
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    },

    async remove(keys) {
      if (!keys.length) return;
      const { client, cfg } = s3();
      // DeleteObjects caps at 1000 keys per call.
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: cfg.bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },

    getPublicUrl(key) {
      const { cfg } = s3();
      return `${cfg.publicBase}/${key}`;
    },

    async getSignedUploadUrl({ key, contentType, bytes, expiresInSeconds = 900 }) {
      const { client, cfg } = s3();
      const command = new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: bytes,
        CacheControl: 'public, max-age=31536000, immutable',
      });
      // Signing ContentLength binds the exact byte count into the signature:
      // a PUT of any other size is rejected by R2 before a byte is stored.
      const url = await getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['content-length', 'content-type']),
      });
      return {
        url,
        key,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(bytes),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        expiresInSeconds,
      };
    },

    async head(key) {
      const { client, cfg } = s3();
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return {
          exists: true,
          bytes: Number(r.ContentLength ?? 0),
          contentType: r.ContentType,
        };
      } catch {
        return { exists: false, bytes: 0 };
      }
    },

    async list(prefix) {
      const { client, cfg } = s3();
      const out: { key: string; bytes: number; lastModified?: Date }[] = [];
      let token: string | undefined;
      do {
        const r = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: 1000,
          }),
        );
        for (const o of r.Contents ?? []) {
          if (o.Key) out.push({ key: o.Key, bytes: Number(o.Size ?? 0), lastModified: o.LastModified });
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
  };
}
