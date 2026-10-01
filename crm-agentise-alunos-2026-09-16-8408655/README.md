# Agentise CRM — edição para alunos

CRM self-hosted para uma organização, com área de trabalho clara e navegação azul-marinho.

## Recursos

- Caixa de entrada WhatsApp oficial (Zernio) e não oficial (Uazapi), com atendimento humano, mídia, notas privadas e atribuição.
- Funis e etapas personalizáveis.
- Dashboard com escolha de indicadores e filtros de período.
- Disparos em massa, templates e métricas de entrega.
- Contatos com importação/exportação, tags e campos personalizados.
- Equipe e integrações configuradas pela própria organização.

Não há limite comercial de contatos ou membros no código desta edição. Capacidade e custos dependem da infraestrutura e dos provedores contratados. Instagram, RAG, follow-ups e vendas/recompra não fazem parte desta edição. Templates são editados manualmente; áudios permanecem disponíveis para reprodução, sem transcrição.

## Instalação independente

1. Extraia o pacote de distribuição em uma pasta nova. Ele não contém credenciais, histórico Git ou vínculo com um deploy existente.
2. Crie seu próprio repositório e importe-o na sua conta Vercel.
3. Crie um projeto Supabase vazio para esta instalação.
4. Abra o endereço do deploy e siga `/setup`: informe os dados do seu Supabase, acesso de bootstrap à Vercel e crie sua conta administradora.
5. O wizard aplica migrations, publica as Edge Functions e configura as quatro variáveis core: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRYPTO_KEY`.
6. Após o bootstrap, entre no CRM. Em Configurações → Credenciais, conecte seus números . Não existe uma quarta etapa obrigatória no wizard. Convide sua equipe em Configurações.

Credenciais de aplicação são criptografadas em `public.app_settings`; dados do CRM ficam em `whatsapp_hub`. Guarde `CRYPTO_KEY` com segurança: ela é necessária para decifrar as credenciais. Não reutilize o banco ou os tokens de outra instalação.

## Demonstração para gravação

Execute `npm run demo` e abra `http://127.0.0.1:5180/dashboard`. A sessão é automática e todos os dados são fictícios. Alterações ficam em memória até reiniciar o servidor.

## Desenvolvimento e validação

```sh
npm ci
npm run dev
npm run build
npm run test:integrations
npm run test:edge
npm run test:distribution
npm run validate:sql
```

O servidor Vite serve o frontend. As rotas `/api` precisam do ambiente Vercel. Para configuração local, copie `.env.example` para `.env.local` e use somente as suas credenciais.

## Gerar uma distribuição

```sh
npm run package:students -- /caminho/para/uma/pasta-nova
```

O empacotador usa uma lista permitida de pastas, rejeita links simbólicos, procura padrões de segredos e compara os arquivos com valores dos `.env` locais sem imprimi-los. O manifesto `DISTRIBUTION.json` registra os hashes SHA-256. Não inclui `.git`, `.vercel`, ambientes, caches, builds, notas privadas ou artefatos de testes. Distribua apenas a pasta gerada, nunca a pasta de desenvolvimento inteira.

## Atualizações

Esta edição foi preparada para instalação nova. A migration `20260915120000_student_edition.sql` desativa o trigger da IA, os jobs de follow-up/recompra e restringe conversas aos dois canais WhatsApp. Tabelas históricas são preservadas para compatibilidade, sem transportar registros do banco original. Em uma instalação antiga, funções já publicadas precisam ser removidas do deploy; excluir os arquivos locais não remove funções remotas.

## Canais por número

Em Credenciais, informe a API Key do Zernio para descobrir os números WhatsApp de todos os perfis acessíveis. A sincronização automática roda a cada minuto, preservando suas preferências. Instâncias Uazapi são cadastradas individualmente com URL e token; o estado de cada uma é atualizado automaticamente.

Cada número permite ativar/desativar o atendimento, escolher operador fixo ou rodízio da equipe, adicionar contatos ao funil selecionado. A distribuição se aplica a novas conversas. As conversas são separadas por contato e número; respostas usam o canal original. Templates oficiais também selecionam seu número de envio.

Use o botão de webhook no card. Uazapi registra `messages` e `connection`, exclui `wasSentByApi` e `isGroupYes` e mantém os dois sufixos de URL desativados. Tokens permanecem no cofre do servidor. O localhost simula essas operações e não envia mensagens.

Instalações existentes precisam aplicar `20260915140000_whatsapp_channels.sql` e publicar as funções atualizadas (`npm run db:push` e `npm run functions:deploy`) junto com o frontend/API. A migration de canais mantém conversas antigas sem canal como histórico legado. Aplique também `20260915160000_remove_ai.sql`, que desativa os triggers de IA e transcrição e impede a reativação por clientes antigos. Remova do Supabase as funções antigas `process-ai-message`, `generate-template`, `transcribe-audio` e `process-knowledge`, caso já tenham sido publicadas. Esta edição não contém recursos de IA. Valide recebimento, resposta e webhook com os seus provedores após o deploy.

Referência de eventos e identificação de contas: [webhooks de inbox do Zernio](https://docs.zernio.com/webhooks/inbox).

## Validação de mensagens WhatsApp

Texto, áudio, imagem, vídeo e documentos possuem testes de contrato com respostas simuladas dos provedores. `npm run test:edge` requer Deno. Esses testes não comprovam entrega em aparelhos reais.

Anexos de até 25MB são guardados no Storage privado e acessados por URLs assinadas. Na Uazapi, o recebimento de mídia usa `/message/download` para obter os bytes descriptografados, sem transcrição. Se o download ou Storage falhar, o webhook retorna 503 para permitir reentrega, em vez de confirmar uma mensagem sem mídia. Confirme a política de retries do seu servidor Uazapi. Mídias antigas que já tinham URLs expiradas não são recuperadas automaticamente.

Após publicar, valide com números controlados os cinco tipos nos dois sentidos e em cada número cadastrado. Confira reprodução/download dos arquivos, conteúdo, conta remetente, ausência de duplicatas e falhas visíveis com uma instância desconectada. WhatsApp oficial continua sujeito à janela de atendimento do provedor. Não há garantia de disponibilidade dos serviços externos.

Contratos consultados: [Uazapi OpenAPI](https://docs.uazapi.com/openapi-bundled.json) e [Zernio envio de mensagens](https://docs.zernio.com/messages/send-inbox-message).

## Licença

MIT. Consulte `LICENSE`.
