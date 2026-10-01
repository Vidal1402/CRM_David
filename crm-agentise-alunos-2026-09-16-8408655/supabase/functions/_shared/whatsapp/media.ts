// Mídias persistidas no bucket privado, sem depender da retenção do provedor.
export const INBOX_MEDIA_BUCKET = 'whatsapp-hub-inbox-media';
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export async function readMediaResponse(response: Response): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error('Não foi possível baixar a mídia.');
  if (Number(response.headers.get('content-length')) > MAX_MEDIA_BYTES) throw new Error('Mídia excede 25MB.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if(done) break; size += value.length;
    if(size > MAX_MEDIA_BYTES) throw new Error('Mídia excede 25MB.'); chunks.push(value);
  }} finally { await reader.cancel(); }
  if (!size) throw new Error('Mídia vazia.');
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;} return bytes;
}
export async function downloadPublicMedia(url: string): Promise<{bytes:Uint8Array;mime:string}> {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.username || parsed.password || /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(parsed.hostname)) throw new Error('URL de mídia inválida.');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  return {bytes:await readMediaResponse(response),mime:response.headers.get('content-type')??'application/octet-stream'};
}
export async function storeInboxMedia(admin: any, path: string, bytes: Uint8Array, mime: string): Promise<string> {
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) throw new Error('Tamanho de mídia inválido.');
  const {error}=await admin.storage.from(INBOX_MEDIA_BUCKET).upload(path,bytes,{contentType:mime,upsert:true});
  if(error)throw new Error('Não foi possível armazenar a mídia.');
  return `storage://${INBOX_MEDIA_BUCKET}/${path}`;
}
