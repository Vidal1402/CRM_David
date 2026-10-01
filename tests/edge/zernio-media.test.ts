import {sendInboxMessage} from '../../supabase/functions/_shared/zernio.ts';
function check(value:unknown,message:string){if(!value)throw new Error(message);}
for(const type of ['text','image','audio','video','file'] as const){
 Deno.test(`Zernio envia ${type} com conta e formato corretos`,async()=>{
  const original=globalThis.fetch;globalThis.fetch=async(url,init)=>{
   check(String(url).endsWith('/inbox/conversations/conversation-test/messages'),'Conversa incorreta');
   check(new Headers(init?.headers).get('Authorization')==='Bearer synthetic','Autenticação incorreta');
   const body=JSON.parse(String(init?.body));check(body.accountId==='account-test','Número incorreto');
   check(body.message==='Teste','Texto ausente');
   if(type!=='text'){check(body.attachmentType===type,'Tipo incorreto');check(body.attachmentUrl==='https://example.com/test','URL incorreta');check(body.attachmentName==='teste.pdf','Nome ausente');}
   return Response.json({success:true,data:{messageId:'wamid.test'}});
  };
  try{const result=await sendInboxMessage({apiKey:'synthetic',accountId:'account-test',conversationId:'conversation-test',text:'Teste',...(type==='text'?{}:{attachmentType:type,attachmentUrl:'https://example.com/test',attachmentName:'teste.pdf'})});check(result.messageId==='wamid.test','ID incorreto');}finally{globalThis.fetch=original;}
 });
}
for(const [name,body,status] of [['sem ID',{success:true},200],['rejeitado',{success:false},200],['limite',{error:'rate limited'},429],['indisponível',{error:'unavailable'},503]] as const){
 Deno.test(`Zernio não confirma envio ${name}`,async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(body,{status});
  let rejected=false;try{await sendInboxMessage({apiKey:'synthetic',accountId:'account',conversationId:'conversation',text:'test'});}catch{rejected=true;}finally{globalThis.fetch=original;}
  check(rejected,'Falha tratada como sucesso');
 });
}
