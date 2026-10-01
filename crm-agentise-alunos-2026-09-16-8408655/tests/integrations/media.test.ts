import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UazapiProvider} from '../../supabase/functions/_shared/whatsapp/uazapi-provider.ts';
import {decodeZernioInbound} from '../../supabase/functions/_shared/whatsapp/zernio-media.ts';
import {readMediaResponse,storeInboxMedia,downloadPublicMedia} from '../../supabase/functions/_shared/whatsapp/media.ts';
const provider=new UazapiProvider('https://instance.example','synthetic-token');
for(const type of ['text','image','audio','video','document'] as const){
 test(`recebe ${type} pelos dois provedores`,()=>{
  const u=provider.parseInboundWebhook({message:{messageid:'test',sender_pn:'5511999999999@s.whatsapp.net',messageType:type,text:'Legenda',fileURL:type==='text'?null:'https://example.com/file'}});
  assert.equal(u?.contentType,type);assert.equal(u?.messageId,'test');
  const z=decodeZernioInbound({text:'Legenda',attachments:type==='text'?[]:[{type:type==='document'?'file':type,url:'https://example.com/file'}]});
  assert.equal(z.contentType,type);assert.equal(z.mediaUrl,type==='text'?null:'https://example.com/file');
 });
 test(`envia ${type} Uazapi com token, destinatário e tipo corretos`,async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{
   assert.ok(String(url).endsWith(type==='text'?'/send/text':'/send/media'));
   const body=JSON.parse(String(init?.body));assert.equal(body.number,'5511999999999');assert.equal(new Headers(init?.headers).get('token'),'synthetic-token');
   if(type!=='text'){assert.equal(body.type,type);assert.equal(body.file,'https://example.com/file');assert.equal(body.docName,'arquivo.pdf');}
   return Response.json({messageid:'confirmed'});
  };
  try{assert.equal((await provider.sendMessage('+5511999999999','Legenda',type==='text'?{}:{mediaUrl:'https://example.com/file',mediaType:type,filename:'arquivo.pdf'})).ok,true);}finally{globalThis.fetch=original;}
 });
}
test('Uazapi baixa bytes descriptografados sem habilitar transcrição',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/message/download'));const body=JSON.parse(String(init?.body));assert.equal(body.transcribe,false);assert.equal(body.return_base64,true);return Response.json({base64Data:'aGVsbG8=',mimetype:'audio/mpeg'});};
 try{const media=await provider.downloadMedia('test');assert.equal(new TextDecoder().decode(media.bytes),'hello');assert.equal(media.mime,'audio/mpeg');}finally{globalThis.fetch=original;}
});
test('falha de download não vira mídia vazia',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'pending'},{status:503});try{await assert.rejects(provider.downloadMedia('test'));}finally{globalThis.fetch=original;}});
test('armazenamento privado verifica falha e guarda bytes',async()=>{const admin={storage:{from:(bucket:string)=>{assert.equal(bucket,'whatsapp-hub-inbox-media');return {upload:async(_path:string,bytes:Uint8Array)=>{assert.equal(bytes.length,3);return {error:null};}};}}};assert.equal(await storeInboxMedia(admin,'test',new Uint8Array([1,2,3]),'image/png'),'storage://whatsapp-hub-inbox-media/test');await assert.rejects(storeInboxMedia({storage:{from:()=>({upload:async()=>({error:'offline'})})}},'test',new Uint8Array([1]),'image/png'));});
test('download rejeita HTTP, localhost, arquivos vazios e tamanho excessivo',async()=>{await assert.rejects(downloadPublicMedia('http://example.com/file'));await assert.rejects(downloadPublicMedia('https://127.0.0.1/file'));await assert.rejects(readMediaResponse(new Response('')));await assert.rejects(readMediaResponse(new Response('x',{headers:{'content-length':String(26*1024*1024)}})));});
