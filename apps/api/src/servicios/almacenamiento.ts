import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

/** Almacenamiento de objetos. En Postgres solo quedan los metadatos y la clave del objeto. */
export interface Almacenamiento {
  readonly bucket: string;
  guardar(clave: string, contenido: Buffer, mime: string, sha256: string): Promise<void>;
  obtener(clave: string): Promise<Readable>;
}

/** MinIO en local, cualquier S3 compatible en producción. Nunca borra: la app no tiene ese permiso. */
export class AlmacenamientoS3 implements Almacenamiento {
  private readonly cliente: S3Client;
  readonly bucket: string;

  constructor(config: Config) {
    this.bucket = config.S3_BUCKET;
    this.cliente = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY && config.S3_SECRET_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
          : undefined,
    });
  }

  async guardar(clave: string, contenido: Buffer, mime: string, sha256: string) {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        Body: contenido,
        ContentType: mime,
        ContentLength: contenido.length,
        Metadata: { sha256 },
      }),
    );
  }

  async obtener(clave: string) {
    const r = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: clave }));
    return r.Body as Readable;
  }
}

/** Para pruebas: guarda los objetos en memoria. */
export class AlmacenamientoMemoria implements Almacenamiento {
  readonly bucket = 'memoria';
  readonly objetos = new Map<string, Buffer>();

  async guardar(clave: string, contenido: Buffer) {
    this.objetos.set(clave, contenido);
  }

  async obtener(clave: string) {
    const o = this.objetos.get(clave);
    if (!o) throw new Error(`Objeto ${clave} no encontrado`);
    return Readable.from(o);
  }
}
