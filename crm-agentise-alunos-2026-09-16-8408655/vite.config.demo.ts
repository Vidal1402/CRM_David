import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { demoPlugin } from './demo/plugin';
// Não carrega .env nem chama serviços externos. Este modo só existe no localhost.
export default defineConfig({
 plugins:[react(),tailwindcss(),demoPlugin()],
 define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:5180/demo-backend'),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('demo-public-key')},
 resolve:{alias:{'@':path.resolve(import.meta.dirname,'src')}},
 server:{host:'127.0.0.1',port:5180,strictPort:true,watch:{ignored:['**/release/**','**/tests/.artifacts/**']}},
});
