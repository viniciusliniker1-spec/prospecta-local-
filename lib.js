// Prospecta Local — lógica pura (sem DOM), testável com `node --test`.

export const STATUSES = ['Novo', 'Contatado', 'Respondeu', 'Fechado', 'Descartado', 'Não contatar'];
export const BLOCKED_STATUSES = ['Descartado', 'Não contatar'];
export const CHANNELS = ['whatsapp', 'instagram', 'email'];
export const CHANNEL_LABEL = { whatsapp: 'WhatsApp', instagram: 'Instagram', email: 'E-mail' };
export const MESSAGE_KINDS = { first: 'Primeiro contato', followup: 'Follow-up' };
const CHAR_LIMIT = { whatsapp: 450, instagram: 350, email: 900 };

// DDDs que existem no Brasil.
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function onlyDigits(s) {
  return String(s ?? '').replace(/\D/g, '');
}

/** Normaliza telefone brasileiro. Retorna null se não parecer um número válido. */
export function normalizeBrPhone(raw) {
  let d = onlyDigits(raw);
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  else d = d.replace(/^0+/, '');
  if (d.length !== 10 && d.length !== 11) return null;
  if (!VALID_DDD.has(Number(d.slice(0, 2)))) return null;
  const isMobile = d.length === 11 && d[2] === '9';
  return { e164: '55' + d, national: d, isMobile };
}

export function formatPhone(national) {
  const d = onlyDigits(national);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(national ?? '');
}

export function waLink(e164, text) {
  return `https://wa.me/${e164}` + (text ? `?text=${encodeURIComponent(text)}` : '');
}

export function mailtoLink(email, subject, body) {
  return `mailto:${email}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
}

/** Aceita "@usuario", "usuario" ou URL do Instagram. Retorna só o usuário ou ''. */
export function cleanHandle(input) {
  const s = String(input ?? '').trim();
  if (!s) return '';
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i) || s.match(/^@?([A-Za-z0-9._]+)$/);
  return m ? m[1].toLowerCase() : '';
}

export function igProfileLink(handle) {
  const h = cleanHandle(handle);
  return h ? `https://www.instagram.com/${h}/` : '';
}

/** Link de busca no Google para achar o Instagram do negócio. */
export function igSearchLink(name, city) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(`site:instagram.com "${name}" ${city || ''}`.trim());
}

/** 'has' (tem site), 'none' (sem site confirmado) ou 'unknown' (não verificado). */
export function siteState(l) {
  if (l.website) return 'has';
  return l.siteUnknown ? 'unknown' : 'none';
}

const NO_SITE_RE = /^(sem|sem site|nao|não|nenhum|none|no|-)$/i;

/** Interpreta o que o usuário digita no campo Site: URL, "sem" ou vazio (não verificado). */
export function parseSiteInput(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { website: '', siteUnknown: true };
  if (NO_SITE_RE.test(v)) return { website: '', siteUnknown: false };
  if (v.includes('.')) return { website: /^https?:\/\//i.test(v) ? v : 'https://' + v, siteUnknown: false };
  return { website: '', siteUnknown: true };
}

export function newLead(fields = {}) {
  return {
    id: '',
    name: '',
    phone: '',
    website: '',
    siteUnknown: false,
    address: '',
    rating: null,
    ratingCount: null,
    mapsUri: '',
    niche: '',
    city: '',
    email: '',
    instagram: '',
    notes: '',
    status: 'Novo',
    messages: {},
    sentAt: {},
    createdAt: new Date().toISOString(),
    ...fields,
  };
}

/** Converte um item da resposta do Places API (New) em lead. */
export function placeToLead(p, ctx = {}) {
  return newLead({
    id: p.id,
    name: p.displayName?.text || '',
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
    website: p.websiteUri || '',
    address: String(p.formattedAddress || '').replace(/, Brasil$/, ''),
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    mapsUri: p.googleMapsUri || '',
    niche: ctx.niche || '',
    city: ctx.city || '',
  });
}

/** Monta o prompt para o Gemini escrever a mensagem. */
export function buildPrompt({ seller, lead, channel, kind = 'first' }) {
  const site = siteState(lead);
  const goodRating = lead.rating >= 4.3 && lead.ratingCount >= 20;
  const channelRules = {
    whatsapp: 'Mensagem de WhatsApp: curta, tom natural e educado, no máximo 450 caracteres, sem assunto.',
    instagram: 'Mensagem de direct do Instagram: bem curta, tom leve, no máximo 350 caracteres, sem assunto.',
    email: 'E-mail: primeira linha "ASSUNTO: ..." (até 60 caracteres), uma linha em branco, depois o corpo com no máximo 900 caracteres e assinatura simples.',
  }[channel];

  const facts = [
    `Nome do negócio: ${lead.name}`,
    lead.niche ? `Segmento: ${lead.niche}` : '',
    lead.city ? `Cidade: ${lead.city}` : '',
    site === 'has' ? `Site atual: ${lead.website} (não critique o site; só mencione se fizer sentido)`
      : site === 'none' ? 'O Google não mostra site para este negócio.'
        : 'Não sei se o negócio tem site: NÃO afirme nem sugira que não tem. Não mencione site.',
    goodRating ? `Avaliação no Google: ${lead.rating} (${lead.ratingCount} avaliações) — pode elogiar de forma natural, sem exagero.` : '',
    lead.notes ? `Observações do vendedor: ${lead.notes}` : '',
  ].filter(Boolean).join('\n');

  const about = [
    `Nome: ${seller.name || '(sem nome)'}`,
    seller.city ? `Cidade: ${seller.city}` : '',
    `O que vende: ${seller.offer || 'criação de landing pages profissionais para negócios locais'}`,
    seller.link ? `Link de exemplos/portfólio: ${seller.link}` : '',
    seller.tone ? `Tom preferido: ${seller.tone}` : '',
  ].filter(Boolean).join('\n');

  const kindRule = kind === 'followup'
    ? 'Isto é um FOLLOW-UP de uma mensagem enviada antes e sem resposta: seja ainda mais curto, retome com leveza, ofereça uma saída fácil e não faça cobrança nem culpa.'
    : 'Isto é o PRIMEIRO contato.';

  return [
    'Você escreve mensagens de prospecção em português do Brasil para um vendedor autônomo.',
    '',
    'SOBRE O VENDEDOR:',
    about,
    '',
    'SOBRE O NEGÓCIO ABORDADO:',
    facts,
    '',
    kindRule,
    channelRules,
    '',
    'REGRAS OBRIGATÓRIAS:',
    '- Identifique-se pelo nome logo no começo e diga em uma frase o que você faz.',
    '- Mencione o nome do negócio e um motivo concreto e verdadeiro para o contato, usando só os dados acima.',
    '- NUNCA invente fatos, números, clientes, prazos, preços ou resultados.',
    '- Faça uma única pergunta simples no final (por exemplo, se pode mostrar um exemplo rápido).',
    '- Inclua uma frase clara dizendo que, se não fizer sentido, basta avisar que você não envia mais mensagens.',
    '- Sem pressão, sem urgência falsa, sem promessas de ganho. No máximo um emoji.',
    '- Não use markdown, não use listas e não explique o que está fazendo.',
    '- Responda SOMENTE com o texto da mensagem pronta para enviar.',
  ].join('\n');
}

/** Remove cercas de código, aspas e rótulos que o modelo às vezes coloca. */
export function cleanModelText(text) {
  let t = String(text ?? '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  t = t.replace(/^(mensagem|texto)\s*:\s*/i, '');
  if (/^["“].*["”]$/s.test(t)) t = t.slice(1, -1).trim();
  return t;
}

/** Separa "ASSUNTO: ..." do corpo. */
export function parseEmailOutput(text) {
  const t = cleanModelText(text);
  const m = t.match(/^\s*assunto\s*:\s*(.+)$/im);
  if (!m) return { subject: '', body: t };
  const body = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim();
  return { subject: m[1].trim(), body };
}

export function messageLimit(channel) {
  return CHAR_LIMIT[channel];
}

// ---------- CSV ----------

export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const norm = (h) => h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const headers = rows[0].map(norm);
  return rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const CSV_COLUMNS = ['nome', 'telefone', 'site', 'email', 'instagram', 'endereco', 'nicho', 'cidade', 'status', 'nota'];

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(leads) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const l of leads) {
    lines.push([l.name, l.phone, siteState(l) === 'none' ? 'sem' : l.website, l.email, l.instagram, l.address, l.niche, l.city, l.status, l.rating ?? '']
      .map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** Converte uma linha de CSV importado em lead (aceita cabeçalhos em PT ou EN). */
export function leadFromRow(row, idx = 0) {
  const pick = (...keys) => keys.map((k) => row[k]).find((v) => v) || '';
  const name = pick('nome', 'name', 'empresa', 'negocio');
  if (!name) return null;
  const phone = pick('telefone', 'phone', 'celular', 'whatsapp');
  const site = parseSiteInput(pick('site', 'website', 'url'));
  const status = STATUSES.includes(pick('status')) ? pick('status') : 'Novo';
  const rating = parseFloat(String(pick('nota', 'rating')).replace(',', '.'));
  return newLead({
    id: 'csv:' + (onlyDigits(phone) || name.toLowerCase().replace(/\s+/g, '-')),
    name,
    phone,
    website: site.website,
    siteUnknown: site.siteUnknown,
    email: pick('email', 'e-mail'),
    instagram: cleanHandle(pick('instagram', 'ig')),
    address: pick('endereco', 'address'),
    niche: pick('nicho', 'niche', 'segmento'),
    city: pick('cidade', 'city'),
    status,
    rating: Number.isFinite(rating) ? rating : null,
  });
}
