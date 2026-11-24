# Elev8 Finance (beta)

App de finanças pessoais da Elev8, instalável como PWA. Beta fechado, um usuário.

- **Endereço:** `finance.elev8solucoes.com.br` (subdomínio na Hostinger atual, pasta separada do site).
- **Servidor:** PHP 8.2+ e MySQL, sem framework e sem custo extra.
- **App:** TypeScript (Etapas D e E).

## Estrutura

```
api/
  public/api/      → vai para public_html/api do subdomínio (front controller + .htaccess)
  src/             → regras: Ledger (parcelas e faturas), Purchases, Metrics, Auth…
  migrations/      → SQL versionado
  bin/             → migrate.php, create-user.php
  tests/run.php    → testes (sem dependências externas)
finance-private/   → FORA do public_html: config.php com senhas e chaves (nunca no Git)
```

## Regras que o código garante

| Regra | Onde |
| --- | --- |
| Compra parcelada = 1 compra-mãe + N parcelas que somam o total exato | `Ledger::split`, `Purchases::create` |
| Cartão: compra depois do fechamento vai para a próxima fatura; parcela conta no mês em que a fatura vence | `Ledger::firstMonth` |
| Retry, refresh ou rede ruim nunca duplicam (chave de idempotência) | `Purchases::create` |
| Duplicidade provável (mesmo valor, dia e lugar em 10 min) pede confirmação | `Purchases::guardDuplicate` |
| "Saiu" conta só gastos; transferência, pagamento de fatura e investimento nunca inflam | `Metrics::summary` |
| Rascunho e cancelado nunca contam | `Ledger::COUNTED` |
| Toda consulta filtra pelo usuário logado; id de outra pessoa = "não encontrado" | todas as classes |
| Descrição, estabelecimento, observação e tags cifrados no banco (libsodium) | `Crypto` |
| Auditoria só com ação e identificadores, nunca valores ou textos | `Audit` |
| Escritas exigem cookie de sessão + token CSRF + origem do app | `App::route` |
| Login: argon2id, 5 erros bloqueiam 15 min, IP e e-mail guardados só como hash | `Auth` |

## App (web/)

TypeScript + Preact + Vite, sem framework pesado (~29 kB comprimido). Telas: Início ("Pode gastar hoje"), Lançar (frase, voz ou campos, sempre com rascunho), Análises (Geral, Fluxo, Categorias, Tendência, Calendário, Futuro), Aprender (11 princípios), Ajustes.

- `src/parser.ts` entende "Uber 28,50 hoje transporte", "Cadeira 480 em 4x cartão XP", "Recebi 4200 salário" e números falados. Roda no aparelho; nada sai antes de confirmar. Quando há ambiguidade, pergunta só o campo que falta.
- Service worker guarda só os arquivos do app, nunca dados da API. Lançamentos confirmados sem internet esperam numa fila local (IndexedDB) e são enviados com a mesma chave de idempotência; a fila é apagada ao sair.
- Atalho da Siri: Ajustes › Instalar explica como criar "Lançar gasto" (Ditar Texto + Abrir URL `/#/lancar?t=`).

```bash
cd web && npm ci && npm test && npm run build
```

## Rodar localmente

```bash
cd api
composer dump-autoload
FINANCE_CONFIG=/caminho/config.php php bin/migrate.php
FINANCE_CONFIG=/caminho/config.php php bin/create-user.php seu@email.com "Seu nome"
php tests/run.php        # precisa de um MySQL de teste (veja o topo do arquivo)
```

## Publicar (resumo; detalhes na Etapa F)

`deploy/package.sh` gera `dist/app` (código PHP, fora do public_html) e `dist/public_html` (app + `/api`).


1. hPanel: criar o subdomínio `finance` com pasta própria **fora** do `public_html` do site, e ativar o SSL.
2. Criar um banco MySQL só para o app.
3. Subir `finance-private/config.php` (a partir de `api/config.sample.php`) um nível acima do `public_html` do subdomínio.
4. `php bin/migrate.php` e `php bin/create-user.php`.
5. **Guardar a `encryption_key` em local seguro fora do servidor.** Sem ela, descrições cifradas não podem ser lidas.
