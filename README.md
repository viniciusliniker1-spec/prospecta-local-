# Prospecta Local

Prospecção **semiautomática** para negócios locais (salões, dentistas, oficinas…), feita para quem vende serviços como landing pages.

1. **Busca** negócios no Google Maps por nicho e cidade (a API informa telefone, site e avaliação).
2. **Destaca** quem não tem site e quem tem celular.
3. **Escreve** uma mensagem personalizada por canal com o Gemini.
4. **Você revisa e envia** por WhatsApp, Instagram ou e-mail, e marca quem já foi contatado.

É um app web estático (HTML + JS, sem servidor, sem dependências). Os dados ficam no navegador do seu celular. Licença MIT.

> O app **nunca envia nada sozinho**. De propósito: envio em massa automático costuma gerar banimento de número e conta, e problemas com a LGPD.

## Como cada canal funciona

| Canal | O que o app faz | O que você faz |
|---|---|---|
| WhatsApp | Abre `wa.me` com o telefone e a mensagem já preenchidos | Revisa e toca em enviar |
| Instagram | Copia a mensagem e abre o perfil (ou uma busca no Google para achar o perfil) | Cola no direct e envia. O Instagram não aceita texto pré-preenchido |
| E-mail | Abre seu app de e-mail com assunto e texto prontos | Revisa e envia. O Google Maps não informa e-mail: preencha no lead |

## Instalar (GitHub Pages, grátis)

1. Crie um repositório no GitHub e envie estes arquivos.
2. Em **Settings → Pages**, escolha a branch `main` e a pasta `/ (root)`.
3. Abra `https://SEU-USUARIO.github.io/NOME-DO-REPO/` no celular e use **Adicionar à tela inicial**.

Também funciona em qualquer hospedagem estática (Cloudflare Pages, Netlify) ou localmente com `python3 -m http.server`.

## Chaves de API (cadastradas em **Ajustes**)

**Google Places API (New)**
1. No Google Cloud, crie um projeto, ative a cobrança e habilite **Places API (New)**.
2. Crie uma chave de API e **restrinja**: por *HTTP referrer* ao endereço do seu app e por API somente à Places API (New). Sem isso, qualquer pessoa que veja a chave pode usá-la.
3. Cole em Ajustes → Google Places API key.

**Gemini API**
1. Gere uma chave no [Google AI Studio](https://aistudio.google.com/apikey).
2. Cole em Ajustes → Gemini API key. O modelo padrão é `gemini-3.1-flash-lite`; mude em Ajustes se preferir outro. Use **Testar Gemini** para conferir.

As chaves ficam salvas só no navegador (localStorage). Use uma chave exclusiva para este app e não use o app em aparelho compartilhado.

## Custos (confira as páginas oficiais, os preços mudam)

- **Places:** o app pede telefone e site, campos que entram nas faixas pagas "Enterprise". Pelo que a documentação do Google informa, SKUs Enterprise têm 1.000 requisições grátis por mês; cada busca devolve até 20 negócios. Veja [preços](https://developers.google.com/maps/billing-and-pricing/pricing).
- **Gemini:** os modelos Flash e Flash-Lite têm camada gratuita com limites de uso; na camada gratuita o Google pode usar os dados para melhorar produtos. Veja [preços](https://ai.google.dev/gemini-api/docs/pricing).
- Defina **alertas de orçamento** e **cotas diárias** no Google Cloud.

## Dados

- **Backup (JSON)** e **Restaurar backup** em Ajustes. O backup não inclui as chaves.
- **Exportar/Importar CSV** com colunas `nome, telefone, site, email, instagram, endereco, nicho, cidade`.
- Os dados existem só neste navegador e neste aparelho. Faça backup de vez em quando.

## Boas práticas (e limites)

- Identifique-se, seja breve e ofereça uma saída fácil. As mensagens geradas já fazem isso.
- Quem pedir para parar vai para o status **Não contatar**; o app bloqueia os envios desse lead.
- Mensagens frias a empresas podem estar sujeitas à LGPD e aos termos do WhatsApp, do Instagram e do Google. Isto não é aconselhamento jurídico: confira as regras que valem para você.
- Os termos do Google Maps Platform restringem guardar conteúdo do Places por longo prazo (não verifiquei os detalhes atuais). Confira antes de manter uma lista grande por muito tempo e, se necessário, apague leads antigos que não viraram conversa.

## Desenvolvimento

```bash
npm test          # testes da lógica (telefone, prompt, CSV…), requer Node 20+
python3 -m http.server 8000
```

- `lib.js`: lógica pura, sem DOM (testada).
- `app.js`: interface e chamadas às APIs.
- `test/lib.test.mjs`: testes.

Ideias para as próximas versões: gerar mensagens em lote, lembrete de follow-up após N dias, templates por nicho.
