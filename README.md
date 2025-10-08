# NovaFrota

Landing page e API mínima para captação de leads em conformidade com o RGPD.

## Estrutura

- `index.html` – Landing page estática com consentimento explícito, ligação ao endpoint `/api/leads` e banner de preferências de cookies.
- `privacidade.html` – Página dedicada à política de privacidade e GDPR.
- `cookies.html` – Política de cookies com categorias, gestão de consentimento e diretrizes de terceiros.
- `termos.html` – Termos e Condições que regulam o uso do site.
- `server.js` – API em Node.js (sem dependências externas) para guardar consentimentos e gerir exportações/apagamentos.
- `data/leads.json` – Ficheiro JSON onde os pedidos são guardados (criado automaticamente na primeira execução).

## Requisitos

- Node.js ≥ 18 (utiliza `fetch`, `crypto.randomUUID()` e módulos ES nativos).

## Como executar o backend

```bash
PORT=3000 ADMIN_API_TOKEN=super-token node server.js
```

Opções de ambiente:

- `PORT` (opcional): porta HTTP (default 3000).
- `HOST` (opcional): host onde o servidor escuta (default `0.0.0.0`).
- `ADMIN_API_TOKEN` (**obrigatório** para exportar/apagar leads): token usado nos pedidos administrativos.

Quando o token não está definido, a captura de leads continua a funcionar, mas operações administrativas são bloqueadas.

## Endpoints

### POST `/api/leads`

Guarda um lead depois de validar email e consentimento.

**Payload JSON**

```json
{
  "email": "pessoa@example.com",
  "consent": true,
  "consentTimestamp": "2025-04-10T15:32:12.123Z",
  "userAgent": "Mozilla/5.0 ..."
}
```

Resposta 202:

```json
{ "ok": true, "id": "uuid-gerado" }
```

### GET `/api/leads`

Retorna todos os registos.

Headers necessários:

- `Authorization: Bearer <ADMIN_API_TOKEN>`

### DELETE `/api/leads/:id`

Remove um registo pelo `id` gerado ou pelo email. Também requer header `Authorization` com o token.

## Fluxo de privacidade recomendado

1. **Recolha** – A landing page grava o email, timestamp e user agent. O servidor acrescenta o hash do IP para auditoria.
2. **Exportação** – Utilize `curl` ou uma ferramenta HTTP com o token administrativo para obter os dados e responder a pedidos de acesso.
3. **Apagamento** – Execute `DELETE /api/leads/<id-ou-email>` para cumprir direitos de esquecimento.
4. **Registos locais** – Se o POST falhar, o front-end guarda o payload em `localStorage` (`novafrota-consents`). Oriente o utilizador a contactar o suporte (`support@novafrota.pt`) para completar o processo manualmente.
5. **Revisões periódicas** – Reavalie a política de privacidade e estes procedimentos sempre que integrarem novos fornecedores ou mudarem a finalidade dos dados.

## Servir a landing page

O projeto é estático, por isso pode ser servido por qualquer servidor web. Se quiser servir landing page + API pelo mesmo processo, utilize um proxy (Nginx, Vercel, Netlify Edge, etc.) ou expanda `server.js` para servir ficheiros estáticos.

## Desenvolvimento

- O código do front-end utiliza fetch assíncrono e trata falhas de rede.
- O servidor grava dados num ficheiro JSON; para ambientes multi-instância considere mover para uma base de dados transacional.
- Não esqueça de fazer backup seguro do ficheiro `data/leads.json`, pois contém dados pessoais.
