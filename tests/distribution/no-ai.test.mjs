import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
test('edição sem IA não distribui endpoints executáveis e desliga os triggers históricos',()=>{
 for(const name of ['generate-template','transcribe-audio','process-ai-message','process-knowledge']) assert.equal(existsSync(`supabase/functions/${name}/index.ts`),false);
 const migration=readFileSync('supabase/migrations/20260915160000_remove_ai.sql','utf8');
 for(const name of ['on_channel_ai','on_inbound_message','on_audio_inbound']) assert.ok(migration.includes(`DROP TRIGGER IF EXISTS ${name}`));
 assert.ok(migration.includes('CHECK (ai_enabled=false)'));
 assert.equal(readFileSync('setup.config.ts','utf8').includes('openai_api_key'),false);
});
