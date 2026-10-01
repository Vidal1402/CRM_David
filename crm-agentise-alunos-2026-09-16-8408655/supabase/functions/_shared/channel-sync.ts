// Lógica compartilhada Node/Deno; recebe o client administrativo e o cofre.
export async function syncZernioChannels(admin: any, apiKey: string) {
 const request=async(path:string)=>{const r=await fetch(`https://zernio.com/api/v1${path}`,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error(`Zernio respondeu HTTP ${r.status}`);return r.json();};
 const body=await request('/accounts');
 if(!Array.isArray(body.accounts))throw new Error('Lista de contas Zernio inválida.');
 const accounts=body.accounts.filter((a:any)=>a.platform==='whatsapp');
 const {data:existing,error:readError}=await admin.from('whatsapp_channels').select('*').eq('provider','zernio');
 if(readError)throw readError;
 const seen:string[]=[];
 await Promise.all(accounts.map(async(a:any)=>{
  const id=a._id??a.id;if(!id)return;seen.push(id);
  const old=existing?.find((c:any)=>c.external_id===id);
  let phone:any={};try{phone=(await request(`/whatsapp/number-info?accountId=${encodeURIComponent(id)}`)).phone??{};}catch{ /* Mantém metadados conhecidos quando o endpoint de saúde está indisponível. */ }
  const profile=a.profileId??a.profile;
  const row={provider:'zernio',external_id:id,profile_id:typeof profile==='string'?profile:profile?._id??null,name:phone.verified_name??a.displayName??a.username??a.name??'WhatsApp Oficial',phone:phone.display_phone_number??old?.phone??null,connected:a.isActive!==false,synced_at:new Date().toISOString()};
  // Update não inclui enabled/operador: descoberta nunca sobrescreve preferências.
  const result=old?await admin.from('whatsapp_channels').update(row).eq('id',old.id):await admin.from('whatsapp_channels').upsert(row,{onConflict:'provider,external_id',ignoreDuplicates:true});
  if(result.error)throw result.error;
 }));
 for(const c of existing??[]){if(!seen.includes(c.external_id)){const {error}=await admin.from('whatsapp_channels').update({connected:false,synced_at:new Date().toISOString()}).eq('id',c.id);if(error)throw error;}}
 return accounts.length;
}

export async function syncUazapiChannels(admin:any,getKey:(key:string)=>Promise<string|null>){
 const {data:channels,error}=await admin.from('whatsapp_channels').select('*').eq('provider','uazapi');if(error)throw error;
 for(const ch of channels??[]){
  const url=await getKey(`channel_${ch.id}_url`),token=await getKey(`channel_${ch.id}_token`);if(!url||!token)continue;
  try{const res=await fetch(`${url}/instance/status`,{headers:{token},redirect:'error',signal:AbortSignal.timeout(8000)});if(!res.ok)continue;const body=await res.json();if(!body.status)continue;
   const result=await admin.from('whatsapp_channels').update({connected:body.status.connected===true,phone:body.instance?.owner??ch.phone,synced_at:new Date().toISOString()}).eq('id',ch.id);if(result.error)throw result.error;
  }catch{/* Falha transitória de consulta não equivale a desconexão. */}
 }
}
