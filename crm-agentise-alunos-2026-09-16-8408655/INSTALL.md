# Instalação

Siga o passo a passo do `README.md`. Use um projeto Supabase vazio e sua própria conta Vercel.

## WhatsApp oficial

Conecte seu número no Zernio e informe a API Key em Configurações → Credenciais após concluir o bootstrap. O backend resolve os identificadores e configura o webhook. Templates e disparos oficiais dependem da aprovação e das regras do provedor.

## WhatsApp não oficial

Informe a URL HTTPS do servidor Uazapi e o token da instância. Configure e verifique a conexão em Configurações → Credenciais. O card informa o webhook desta instalação e o estado da conexão.

## Integrações de leads

`ingest-lead` e `grupozap-leads` recebem leads conforme seus contratos e autenticação. O arquivo `public/ah-tracker.js` é um recurso opcional para formulários externos. Cadastre sempre o endereço do seu próprio Supabase. A integração histórica Canal Pro não é oferecida na interface desta edição.

## Validação após instalar

- Entre com a conta administradora e convide um operador.
- Envie uma mensagem de teste de outro número para cada provedor configurado e responda pela caixa de entrada.
- Crie um funil e importe um contato de teste; exporte-o para conferir o arquivo.
- Selecione os indicadores do dashboard.
- Teste um disparo somente para um contato autorizado antes de usar uma audiência maior.

Nenhuma credencial de aluno é fornecida pelo pacote. Tokens de bootstrap são usados para configurar a infraestrutura; as chaves de aplicação ficam criptografadas no banco da própria instalação.
