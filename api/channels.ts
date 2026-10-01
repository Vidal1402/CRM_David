import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { requireAdmin } from '../src/lib/admin-auth.js';
import { getCredential, setCredential } from '../src/lib/credentials.js';
import { registerWebhook } from '../src/lib/zernio.js';
import { registerUazapiWebhook } from '../src/lib/uazapi-webhook.js';
import { syncZernioChannels, syncUazapiChannels } from '../supabase/functions/_shared/channel-sync.js';

type Req={method?:string;headers?:Record<string,string|string[]|undefined>;body?:any};
type Res={status:(n:number)=>Res;json:(b:unknown)=>void;end:()=>void};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req:Req,res:Res){
 try{
  const auth=await requireAdmin(req.headers?.authorization);if(auth.ok===false)return res.status(auth.status).json({error:auth.message});
  const admin=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{db:{schema:'whatsapp_hub'},auth:{persistSession:false}});
  const body=req.body??{};
  const must=async(q:any)=>{const r=await q;if(r.error)throw new Error(r.error.message);return r.data;};
  const channel=async(id:string)=>{if(!uuid.test(id??''))throw new Error('Número inválido.');const row=await must(admin.from('whatsapp_channels').select('*').eq('id',id).single());return row;};
  const base=process.env.SUPABASE_URL!.replace(/\/$/,'');
  const connectHook=async(c:any)=>{
   if(c.provider==='zernio'){
    const key=await getCredential('zernio_api_key');if(!key)throw new Error('Cadastre a chave Zernio.');
    let secret=await getCredential('zernio_webhook_secret');if(!secret){secret=randomBytes(32).toString('hex');await setCredential('zernio_webhook_secret',secret);}
    await registerWebhook(key,{url:`${base}/functions/v1/zernio-webhook`,secret});
    await must(admin.from('whatsapp_channels').update({webhook_ready:true}).eq('provider','zernio'));
   }else{
    const token=await getCredential(`channel_${c.id}_token`),server=await getCredential(`channel_${c.id}_url`);if(!token||!server)throw new Error('Credenciais da instância ausentes.');
    let secret=await getCredential(`channel_${c.id}_webhook`);if(!secret){secret=randomBytes(32).toString('hex');await setCredential(`channel_${c.id}_webhook`,secret);}
    await registerUazapiWebhook(server,token,`${base}/functions/v1/whatsapp-inbound?provider=uazapi&channel_id=${c.id}&secret=${secret}`);
    await must(admin.from('whatsapp_channels').update({webhook_ready:true}).eq('id',c.id));
   }
  };
  if(req.method==='PATCH'){
   const c=await channel(body.id);const patch:Record<string,unknown>={};
   for(const k of ['enabled','add_to_funnel']){if(k in body){if(typeof body[k]!=='boolean')throw new Error('Opção inválida.');patch[k]=body[k];}}
   if('assignment_mode' in body){if(!['fixed','round_robin'].includes(body.assignment_mode))throw new Error('Distribuição inválida.');patch.assignment_mode=body.assignment_mode;}
   for(const [key,table,col] of [['operator_id','app_users','user_id'],['pipeline_id','pipelines','id']]){
    if(key in body){if(body[key]!==null){if(!uuid.test(body[key]))throw new Error('Seleção inválida.');await must(admin.from(table).select(col).eq(col,body[key]).single());}patch[key]=body[key];}
   }
   const next={...c,...patch};if(next.assignment_mode==='fixed'&&!next.operator_id)throw new Error('Selecione o operador fixo.');if(next.add_to_funnel&&!next.pipeline_id)throw new Error('Selecione o funil.');
   await must(admin.from('whatsapp_channels').update(patch).eq('id',c.id));
  }else if(req.method==='POST'){
   if(body.action==='sync'||body.action==='connect_zernio'){
    if(body.api_key){if(!/^sk_[a-f0-9]{64}$/i.test(body.api_key))throw new Error('Chave Zernio inválida.');const r=await fetch('https://zernio.com/api/v1/accounts',{headers:{Authorization:`Bearer ${body.api_key}`},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Não foi possível validar a chave Zernio.');await setCredential('zernio_api_key',body.api_key);}
    const key=await getCredential('zernio_api_key');if(key)await syncZernioChannels(admin,key);
    await syncUazapiChannels(admin,getCredential);
   }else if(body.action==='add_uazapi'){
    const server=String(body.server_url??'').replace(/\/+$/,'');const parsed=new URL(server);if(parsed.protocol!=='https:'||parsed.username||parsed.password||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(parsed.hostname))throw new Error('Use a URL HTTPS pública do servidor Uazapi.');
    const token=String(body.token??'').trim();if(!token||!String(body.name??'').trim())throw new Error('Preencha o nome e o token.');
    const r=await fetch(`${server}/instance/status`,{headers:{token},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Token ou servidor Uazapi inválido.');const status=await r.json();if(!status.instance)throw new Error('Resposta Uazapi inválida.');
    const external=createHash('sha256').update(server+':'+String(status.instance.id??status.instance.instanceId??token)).digest('hex');
    const existing=await must(admin.from('whatsapp_channels').select('*').eq('provider','uazapi').eq('external_id',external).maybeSingle());const id=existing?.id??randomUUID();
    await setCredential(`channel_${id}_token`,token);await setCredential(`channel_${id}_url`,server);
    await must(admin.from('whatsapp_channels').upsert({id,provider:'uazapi',external_id:external,name:String(body.name).trim(),phone:status.instance.owner??null,connected:!!status.status?.connected,synced_at:new Date().toISOString()},{onConflict:'provider,external_id'}));
    try{await connectHook(await channel(id));}catch{return res.status(200).json({success:true,warning:'Instância salva. Não foi possível registrar o webhook; use o botão Conectar webhook.',channels:await must(admin.from('whatsapp_channels').select('*').order('created_at'))});}
   }else if(body.action==='webhook'){await connectHook(await channel(body.id));}
   else throw new Error('Ação inválida.');
  }else if(req.method!=='GET')return res.status(405).end();
  const channels=await must(admin.from('whatsapp_channels').select('*').order('created_at'));
  return res.status(200).json({success:true,channels,zernio_configured:!!await getCredential('zernio_api_key')});
 }catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Falha ao configurar canais.'});}
}
