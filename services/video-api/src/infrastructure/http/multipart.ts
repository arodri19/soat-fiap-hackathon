import busboy from 'busboy';
import type { Request } from 'express';
import type { Readable } from 'node:stream';
import { MissingVideoFileError, VideoTooLargeError } from '../../domain/errors';

export interface IncomingFile {
  filename: string;
  mimeType: string;
  stream: Readable;
}

/**
 * Lê um multipart/form-data em streaming e entrega o campo `fieldName` para `handle`
 * assim que ele começa a chegar. O arquivo nunca é carregado inteiro em memória.
 * Se passar de `maxBytes`, o stream é destruído com VideoTooLargeError.
 */
export function handleSingleFileUpload<T>(
  req: Request,
  fieldName: string,
  maxBytes: number,
  handle: (file: IncomingFile) => Promise<T>,
): Promise<T> {
  // Rejeita cedo quando o Content-Length já denuncia um arquivo grande demais
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes + 1024 * 1024) {
    req.resume();
    return Promise.reject(new VideoTooLargeError(maxBytes));
  }

  return new Promise<T>((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: 10, fieldSize: 1024 },
      });
    } catch {
      reject(new MissingVideoFileError()); // Content-Type não é multipart
      return;
    }

    let result: Promise<T> | undefined;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    /** Para de processar o corpo e só descarta o que ainda chegar (a resposta sai já). */
    const abandon = () => {
      req.unpipe(parser);
      req.resume();
    };

    parser.on('file', (name, stream, info) => {
      if (name !== fieldName || result) {
        stream.resume();
        return;
      }
      stream.on('limit', () => stream.destroy(new VideoTooLargeError(maxBytes)));
      result = handle({ filename: info.filename ?? '', mimeType: info.mimeType, stream });
      // Responde assim que o upload termina ou falha: com o stream destruído (limite
      // excedido) o parser não chega a emitir 'close', então não dá para esperar por ele.
      result.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) =>
          finish(() => {
            abandon();
            reject(error);
          }),
      );
    });

    parser.on('error', () =>
      finish(() => {
        abandon();
        reject(new MissingVideoFileError());
      }),
    );
    parser.on('close', () => {
      if (!result) finish(() => reject(new MissingVideoFileError()));
    });

    req.pipe(parser);
  });
}
