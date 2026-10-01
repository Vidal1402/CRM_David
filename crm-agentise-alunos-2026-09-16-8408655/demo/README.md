# Demonstração local para gravação

Execute `npm run demo` e abra http://127.0.0.1:5180/dashboard.

O acesso é automático como administradora. Contatos, equipe, conversas, funis, resultados, campanhas, templates e conexões são fictícios. O servidor emula o backend em memória: navegação, edição de registros e envio de texto/nota na inbox não usam Supabase ou WhatsApp reais. Reiniciar o servidor restaura os dados iniciais.

Este servidor escuta apenas na máquina local. `npm run dev` e builds de produção não usam o backend de demonstração. Uploads e recursos externos não são reproduzidos integralmente pelo simulador.
