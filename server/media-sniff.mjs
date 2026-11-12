import { fileTypeFromBuffer } from 'file-type';

// Fixed operation: inspect only the bounded bytes supplied on stdin.
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 65_536) throw new Error('Header limit');
    chunks.push(chunk);
  }
  const type = await fileTypeFromBuffer(Buffer.concat(chunks));
  const mime = { 'audio/x-m4a': 'audio/mp4', 'audio/ogg; codecs=opus': 'audio/ogg' }[type?.mime] || type?.mime;
  process.stdout.write(JSON.stringify(type ? { mime, ext: type.ext } : null));
} catch {
  process.exitCode = 1;
}
