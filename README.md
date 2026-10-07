# Copiloto da Barbearia

SaaS multi-barbearia: agenda, fila de espera, encaixe automático, clientes, financeiro, marketing, metas e painel.
Next.js 16 + Postgres (Neon). Dependências de produção: `next`, `react`, `pg`, `zod` e duas fontes. Custo inicial: zero (Neon Free + Vercel Hobby).

## Colocar no ar

1. **Neon**: crie um projeto (região `sa-east-1`, São Paulo). Copie a connection string do dono (`neondb_owner`).
2. **Migração** (na sua máquina):
   ```bash
   npm install
   export DATABASE_URL_OWNER='postgresql://neondb_owner:...neon.tech/neondb?sslmode=require'
   export APP_DB_PASSWORD="$(openssl rand -base64 32)"   # guarde este valor
   npm run db:migrate
   ```
   Isso cria as tabelas, as regras de acesso e o papel restrito `barber_app`.
3. **Vercel**: importe o repositório e defina as variáveis:
   - `DATABASE_URL` = a URL *pooled* do Neon, trocando usuário e senha por `barber_app` e `APP_DB_PASSWORD`
   - `APP_URL` = endereço público (ex.: `https://sua-barbearia.vercel.app`)
   
   **Nunca** coloque `DATABASE_URL_OWNER` na Vercel: o app não precisa dela.
4. Abra `/cadastro`, crie sua barbearia, confira o horário de funcionamento e cadastre barbeiros e serviços.

Rodar local: copie `.env.example` para `.env.local` e `npm run dev`.

Dados de demonstração (opcional, separados do produto): `npm run db:seed` cria uma barbearia fictícia e imprime o login.

## Segurança

| Camada | O que faz |
|---|---|
| Isolamento por barbearia | Row-Level Security em todas as tabelas. O app conecta com um papel que não é dono das tabelas; cada transação carrega barbearia, usuário e perfil. Uma consulta sem `WHERE` continua sem ver outra barbearia. |
| Referências cruzadas | Chaves estrangeiras compostas `(barbershop_id, id)`: é impossível agendar com cliente, barbeiro ou serviço de outra barbearia. |
| Perfis | Admin, Recepção e Barbeiro são aplicados no banco (políticas) e de novo no servidor (cada ação). Barbeiro só vê a própria agenda e clientes; financeiro é só do admin. |
| Senhas | scrypt (N=2^16, r=8, p=2) com sal por usuário. O app não consegue ler a coluna de senha; só funções `SECURITY DEFINER`. |
| Sessões | Token aleatório de 256 bits; o banco guarda só o SHA-256. Cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, 7 dias. Trocar senha ou desativar usuário derruba as sessões. |
| Força bruta | 5 erros por e-mail ou 30 por IP em 15 min bloqueiam o login; cadastro limitado a 5 por hora por IP. Resposta em tempo constante, sem revelar se o e-mail existe. |
| Injeção | Todas as consultas parametrizadas; toda entrada validada com zod no servidor; CSV exportado neutraliza fórmulas. |
| Navegador | CSP estrita com nonce por requisição (sem `unsafe-inline`), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Server Actions conferem a origem (CSRF). |
| Integridade | O banco impede dois atendimentos no mesmo barbeiro e horário (exclusion constraint). |
| Auditoria | `audit_log` só aceita inserção: o app não altera nem apaga registros. |

Verifique você mesmo, em um banco de teste: `npm run test:security` (39 verificações de isolamento e perfis).

### O que fica por sua conta
- Ative 2FA nas contas Neon, Vercel e GitHub: quem entra nelas entra no banco.
- O RLS protege contra falhas do app, mas quem obtiver a `DATABASE_URL` do app pode se passar por qualquer barbearia. Trate-a como segredo e troque a senha se vazar (`npm run db:migrate` com outra `APP_DB_PASSWORD`).
- Não há 2FA de usuário, recuperação de senha por e-mail nem verificação de e-mail no cadastro (sem provedor de e-mail no custo zero). A recuperação é por código gerado em Configurações.
- LGPD: o sistema guarda nome, telefone e nascimento de clientes. Tenha política de privacidade; o admin pode excluir clientes sem histórico.
- Antes de vender para terceiros, contrate um pentest independente. Nenhum sistema é "à prova de invasão".

## Tipos de negócio
O mesmo sistema atende barbearias e estúdios de design de sobrancelhas. O tipo é escolhido no cadastro (`/cadastro?tipo=sobrancelha`) e muda o vocabulário (profissional, estúdio), as mensagens padrão e a identidade visual. Para criar outro tipo, acrescente uma entrada em `src/lib/terms.ts` e um bloco de cores em `globals.css`.

## Senhas
Login e cadastro têm "Mostrar senha" e confirmação. Sem provedor de e-mail, a recuperação usa um código gerado em Configurações (mostrado uma vez, uso único) na tela "Esqueci a senha"; admins também redefinem senhas da equipe.

## Agendamento online
Cada barbearia tem uma página pública (`/b/endereco-da-barbearia`, link em Configurações). O cliente escolhe serviço, barbeiro, dia e horário livre e informa nome e WhatsApp; sem vaga, entra na fila de espera. Proteções: 6 pedidos por hora por conexão, no máximo 2 horários futuros por telefone, janela de antecedência configurável, e pode ser desligado em Configurações. Não há confirmação por SMS: alguém mal-intencionado ainda pode marcar horários falsos dentro desses limites.

## Como funciona o encaixe
Cancelou um horário → o sistema procura na fila quem quer aquele dia, cabe na janela (com a tolerância), tem serviço que cabe no tempo livre e que o barbeiro faz. Ordem: prioridade → pediu o barbeiro → chegou primeiro. O convite gera a mensagem com um link; o cliente toca em "Quero este horário" e o agendamento é criado sozinho (ou o atendente confirma). Em Configurações dá para enviar automaticamente ao primeiro ou a todos.

Mensagens: provedor `manual` (copiar / abrir WhatsApp, grátis). Para WhatsApp oficial, Instagram, Google, e-mail e pagamentos, implemente o adaptador em `src/integrations/`.

## Ainda não incluído (fase 2 do seu documento)
WhatsApp oficial, importação automática de Instagram/Google (hoje os números são lançados à mão em Marketing), campanhas automáticas, IA e previsão de faturamento.
