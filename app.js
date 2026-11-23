import {
  STATUSES, BLOCKED_STATUSES, CHANNELS, CHANNEL_LABEL, MESSAGE_KINDS,
  normalizeBrPhone, formatPhone, waLink, mailtoLink, cleanHandle, igProfileLink, igSearchLink,
  placeToLead, buildPrompt, cleanModelText, parseEmailOutput, messageLimit,
  parseCsv, toCsv, leadFromRow,
} from './lib.js';

const KEY = 'prospecta-local.v1';
const DEFAULTS = {
  sellerName: '', sellerCity: '', offer: '', link: '', tone: '',
  placesKey: '', geminiKey: '', model: 'gemini-3.1-flash-lite',
};
const PLACES_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
  'places.googleMapsUri', 'places.businessStatus', 'nextPageToken',
].join(',');

// ---------- estado ----------

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return { settings: { ...DEFAULTS, ...(s?.settings || {}) }, leads: s?.leads || {} };
  } catch {
    return { settings: { ...DEFAULTS }, leads: {} };
  }
}
let state = load();
const ui = {
  tab: 'leads',
  open: null,
  channel: {},
  busy: new Set(),
  filter: { q: '', status: 'Ativos', noSite: false, mobileOnly: false },
  search: { niche: '', city: '', token: '', info: '', busy: false },
};

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Não consegui salvar no navegador (armazenamento cheio ou bloqueado). Faça um backup.'); }
}

// ---------- utilidades ----------

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignora */ }
    ta.remove();
    return ok;
  }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openUrl(url) {
  window.open(url, '_blank', 'noopener');
}

const isBlocked = (l) => BLOCKED_STATUSES.includes(l.status);
const chOf = (id) => ui.channel[id] || 'whatsapp';
const msgOf = (l, ch) => l.messages?.[ch] || { text: '', subject: '', kind: 'first' };

function setMsg(l, ch, patch) {
  l.messages = l.messages || {};
  l.messages[ch] = { ...msgOf(l, ch), ...patch };
}

// ---------- APIs ----------

async function apiError(res) {
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; } catch { /* sem corpo */ }
  return new Error(detail || `Erro ${res.status}`);
}

async function placesSearch({ niche, city, pageToken }) {
  const key = state.settings.placesKey;
  if (!key) throw new Error('Cadastre a chave do Google Places em Ajustes.');
  const body = { textQuery: `${niche} em ${city}`, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20 };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': PLACES_FIELDS },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  return { places: data.places || [], next: data.nextPageToken || '' };
}

async function geminiText(prompt) {
  const { geminiKey, model } = state.settings;
  if (!geminiKey) throw new Error('Cadastre a chave do Gemini em Ajustes.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || DEFAULTS.model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('A IA não devolveu texto (pode ter sido bloqueada). Tente de novo.');
  return text;
}

const seller = () => ({
  name: state.settings.sellerName, city: state.settings.sellerCity,
  offer: state.settings.offer, link: state.settings.link, tone: state.settings.tone,
});

// ---------- listas ----------

const leadsArray = () => Object.values(state.leads);

function filteredLeads() {
  const { q, status, noSite, mobileOnly } = ui.filter;
  const needle = q.trim().toLowerCase();
  const order = Object.fromEntries(STATUSES.map((s, i) => [s, i]));
  return leadsArray()
    .filter((l) => {
      if (status === 'Ativos' ? isBlocked(l) : status !== 'Todos' && l.status !== status) return false;
      if (noSite && l.website) return false;
      if (mobileOnly && !normalizeBrPhone(l.phone)?.isMobile) return false;
      if (needle && !`${l.name} ${l.niche} ${l.city} ${l.address}`.toLowerCase().includes(needle)) return false;
      return true;
    })
    .sort((a, b) =>
      (order[a.status] - order[b.status])
      || (Boolean(a.website) - Boolean(b.website))
      || (Number(Boolean(normalizeBrPhone(b.phone)?.isMobile)) - Number(Boolean(normalizeBrPhone(a.phone)?.isMobile)))
      || ((b.ratingCount || 0) - (a.ratingCount || 0)));
}

// ---------- render ----------

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const all = leadsArray();
  $('#count').textContent = `${all.length} leads · ${all.filter((l) => !l.website).length} sem site`;
  $('#app').innerHTML = ui.tab === 'leads' ? viewLeads() : ui.tab === 'search' ? viewSearch() : viewSettings();
}

function viewLeads() {
  const f = ui.filter;
  const list = filteredLeads();
  const statusOpts = ['Ativos', 'Todos', ...STATUSES]
    .map((s) => `<option ${s === f.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
  return `
    <div class="filters">
      <input type="search" placeholder="Buscar por nome, nicho ou cidade" value="${esc(f.q)}" data-filter="q">
      <select data-filter="status">${statusOpts}</select>
      <div class="checks">
        <label><input type="checkbox" data-filter="noSite" ${f.noSite ? 'checked' : ''}> Sem site</label>
        <label><input type="checkbox" data-filter="mobileOnly" ${f.mobileOnly ? 'checked' : ''}> Só celular</label>
      </div>
    </div>
    ${list.length ? list.map(cardHtml).join('') : `<div class="empty">${leadsArray().length ? 'Nenhum lead com esses filtros.' : 'Nenhum lead ainda. Vá em <b>Buscar</b> para encontrar negócios.'}</div>`}`;
}

function cardHtml(l) {
  const n = normalizeBrPhone(l.phone);
  const open = ui.open === l.id;
  const badges = [
    l.niche ? `<span class="badge">${esc(l.niche)}</span>` : '',
    l.website ? '<span class="badge">tem site</span>' : '<span class="badge nosite">sem site</span>',
    n?.isMobile ? '<span class="badge mobile">celular</span>' : '',
    l.rating ? `<span class="badge">★ ${esc(l.rating)} (${esc(l.ratingCount ?? 0)})</span>` : '',
  ].join('');
  return `
    <article class="card ${isBlocked(l) || l.status === 'Fechado' ? 'done' : ''}">
      <div class="head" data-act="toggle" data-id="${esc(l.id)}">
        <div>
          <div class="name">${esc(l.name)}</div>
          <div class="meta">${badges}</div>
        </div>
        <span class="badge">${esc(l.status)}</span>
      </div>
      ${open ? detailHtml(l, n) : ''}
    </article>`;
}

function detailHtml(l, n) {
  const id = esc(l.id);
  const ch = chOf(l.id);
  const m = msgOf(l, ch);
  const busy = ui.busy.has(l.id);
  const blocked = isBlocked(l);
  const limit = messageLimit(ch);
  const sent = l.sentAt?.[ch];
  const statusOpts = STATUSES.map((s) => `<option ${s === l.status ? 'selected' : ''}>${esc(s)}</option>`).join('');
  const kindOpts = Object.entries(MESSAGE_KINDS)
    .map(([k, v]) => `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${v}</option>`).join('');

  const info = [
    n ? `Telefone: ${esc(formatPhone(n.national))}${n.isMobile ? '' : ' (fixo, o WhatsApp pode não existir)'}` : (l.phone ? `Telefone: ${esc(l.phone)} (formato não reconhecido)` : 'Sem telefone'),
    l.address ? esc(l.address) : '',
    l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : '',
    l.mapsUri ? `<a href="${esc(l.mapsUri)}" target="_blank" rel="noopener">Google Maps</a>` : '',
  ].filter(Boolean).join(' · ');

  const openLabel = { whatsapp: 'Abrir no WhatsApp', instagram: cleanHandle(l.instagram) ? 'Abrir perfil e copiar' : 'Achar Instagram e copiar', email: 'Abrir no e-mail' }[ch];

  return `
    <div class="detail">
      <div class="muted">${info}</div>
      <div class="seg">${CHANNELS.map((c) => `<button class="${c === ch ? 'on' : ''}" data-act="channel" data-id="${id}" data-ch="${c}">${CHANNEL_LABEL[c]}${l.sentAt?.[c] ? ' ✓' : ''}</button>`).join('')}</div>
      ${blocked ? '<div class="note">Este lead está marcado como não contatar/descartado. Envios desativados.</div>' : ''}
      ${sent ? `<div class="muted">Marcado como enviado em ${fmtDate(sent)}.</div>` : ''}
      <div class="row grow">
        <select data-kind data-id="${id}">${kindOpts}</select>
        <button class="btn primary" data-act="gen" data-id="${id}" ${busy || blocked ? 'disabled' : ''}>${busy ? 'Gerando…' : 'Gerar com IA'}</button>
      </div>
      ${ch === 'email' ? `<label>Assunto</label><input type="text" value="${esc(m.subject)}" data-subj data-id="${id}">` : ''}
      <label>Mensagem</label>
      <textarea data-msg data-id="${id}" placeholder="Clique em Gerar com IA ou escreva a sua">${esc(m.text)}</textarea>
      <div class="counter ${m.text.length > limit ? 'over' : ''}">${m.text.length}/${limit}</div>
      <div class="row grow">
        <button class="btn" data-act="copy" data-id="${id}">Copiar</button>
        <button class="btn green" data-act="open" data-id="${id}" ${blocked ? 'disabled' : ''}>${openLabel}</button>
      </div>
      <div class="row grow">
        <button class="btn" data-act="sent" data-id="${id}" ${blocked ? 'disabled' : ''}>Marcar como enviado</button>
        <button class="btn danger" data-act="remove" data-id="${id}">Remover</button>
      </div>
      <p class="muted">${ch === 'instagram' ? 'O Instagram não aceita mensagem pré-preenchida: o texto é copiado e você cola no direct.' : 'Você revisa e envia. O app nunca envia sozinho.'}</p>
      <h2>Dados do lead</h2>
      <label>Status</label>
      <select data-lf="status" data-id="${id}">${statusOpts}</select>
      <div class="row grow">
        <div><label>Instagram (@usuário ou link)</label><input type="text" value="${esc(l.instagram)}" data-lf="instagram" data-id="${id}" placeholder="@negocio"></div>
        <div><label>E-mail</label><input type="email" value="${esc(l.email)}" data-lf="email" data-id="${id}" placeholder="contato@negocio.com"></div>
      </div>
      <label>Observações</label>
      <textarea style="min-height:60px" data-lf="notes" data-id="${id}" placeholder="Ex.: pediu para falar na segunda">${esc(l.notes)}</textarea>

    </div>`;
}

function viewSearch() {
  const s = ui.search;
  const city = s.city || state.settings.sellerCity;
  return `
    <h2>Buscar negócios no Google Maps</h2>
    <label>Nicho</label>
    <input type="text" id="s-niche" value="${esc(s.niche)}" placeholder="Ex.: salão de beleza, dentista, oficina">
    <label>Cidade</label>
    <input type="text" id="s-city" value="${esc(city)}" placeholder="Ex.: Campinas SP">
    <div class="row grow">
      <button class="btn primary" data-act="search" ${s.busy ? 'disabled' : ''}>${s.busy ? 'Buscando…' : 'Buscar'}</button>
      ${s.token ? `<button class="btn" data-act="more" ${s.busy ? 'disabled' : ''}>Carregar mais</button>` : ''}
    </div>
    ${s.info ? `<p>${esc(s.info)}</p><div class="row"><button class="btn" data-act="see">Ver leads</button></div>` : ''}
    <p class="muted">Cada busca é uma chamada paga na API do Google (há crédito mensal gratuito). Veja o custo atual no README.</p>`;
}

function viewSettings() {
  const st = state.settings;
  const input = (key, label, type = 'text', ph = '') =>
    `<label>${label}</label><input type="${type}" data-set="${key}" value="${esc(st[key])}" placeholder="${esc(ph)}" autocomplete="off">`;
  return `
    <h2>Sobre você</h2>
    ${input('sellerName', 'Seu nome', 'text', 'Como você se apresenta')}
    ${input('sellerCity', 'Sua cidade', 'text', 'Campinas SP')}
    <label>O que você vende</label>
    <textarea style="min-height:70px" data-set="offer" placeholder="Ex.: landing pages profissionais para negócios locais, prontas em poucos dias">${esc(st.offer)}</textarea>
    ${input('link', 'Link de exemplos/portfólio (opcional)', 'text', 'https://...')}
    ${input('tone', 'Tom das mensagens (opcional)', 'text', 'Ex.: simpático e direto')}

    <h2>Chaves de API</h2>
    <p class="muted">Ficam só neste navegador. Não use este app em computador compartilhado.</p>
    ${input('placesKey', 'Google Places API key', 'password')}
    ${input('geminiKey', 'Gemini API key', 'password')}
    ${input('model', 'Modelo do Gemini', 'text', DEFAULTS.model)}
    <div class="row"><button class="btn" data-act="test-gemini">Testar Gemini</button></div>

    <h2>Dados</h2>
    <div class="row grow">
      <button class="btn" data-act="export-json">Backup (JSON)</button>
      <button class="btn" data-act="import-json">Restaurar backup</button>
    </div>
    <div class="row grow">
      <button class="btn" data-act="export-csv">Exportar CSV</button>
      <button class="btn" data-act="import-csv">Importar CSV</button>
    </div>
    <p class="muted">O CSV importado aceita colunas: nome, telefone, site, email, instagram, endereco, nicho, cidade.</p>
    <div class="row"><button class="btn danger" data-act="wipe">Apagar todos os leads</button></div>
    <p class="muted">Boas práticas: envie só mensagens reveladoras de quem você é, respeite pedidos para parar e registre quem pediu (status "Não contatar"). Siga a LGPD.</p>`;
}

// ---------- ações ----------

async function onGenerate(id) {
  const l = state.leads[id];
  const ch = chOf(id);
  const m = msgOf(l, ch);
  ui.busy.add(id);
  render();
  try {
    const raw = await geminiText(buildPrompt({ seller: seller(), lead: l, channel: ch, kind: m.kind }));
    if (ch === 'email') {
      const { subject, body } = parseEmailOutput(raw);
      setMsg(l, ch, { subject, text: body, at: now() });
    } else {
      setMsg(l, ch, { text: cleanModelText(raw), at: now() });
    }
    save();
  } catch (e) {
    toast(e.message);
  } finally {
    ui.busy.delete(id);
    render();
  }
}

async function onOpen(id) {
  const l = state.leads[id];
  const ch = chOf(id);
  const m = msgOf(l, ch);
  if (!m.text.trim()) return toast('Escreva ou gere a mensagem primeiro.');
  if (ch === 'whatsapp') {
    const n = normalizeBrPhone(l.phone);
    if (!n) return toast('Este lead não tem um telefone válido.');
    openUrl(waLink(n.e164, m.text));
  } else if (ch === 'instagram') {
    const ok = await copyText(m.text);
    const handle = cleanHandle(l.instagram);
    openUrl(handle ? igProfileLink(handle) : igSearchLink(l.name, l.city));
    toast(ok ? 'Mensagem copiada. Cole no direct.' : 'Não consegui copiar. Copie o texto manualmente.');
  } else {
    if (!l.email) return toast('Preencha o e-mail do lead.');
    openUrl(mailtoLink(l.email, m.subject, m.text));
  }
}

async function runSearch(more) {
  const s = ui.search;
  if (!more) {
    s.niche = $('#s-niche')?.value.trim() || s.niche;
    s.city = $('#s-city')?.value.trim() || s.city;
    s.token = '';
  }
  const city = s.city || state.settings.sellerCity;
  if (!s.niche || !city) return toast('Preencha nicho e cidade.');
  s.busy = true;
  render();
  try {
    const { places, next } = await placesSearch({ niche: s.niche, city, pageToken: more ? s.token : '' });
    let added = 0;
    for (const p of places) {
      if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') continue;
      if (!p.id || state.leads[p.id]) continue;
      state.leads[p.id] = placeToLead(p, { niche: s.niche, city });
      added++;
    }
    s.token = next;
    s.info = `${places.length} encontrados, ${added} novos${next ? '. Há mais resultados.' : '.'}`;
    save();
  } catch (e) {
    s.info = '';
    toast(e.message);
  } finally {
    s.busy = false;
    render();
  }
}

async function handleClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; return render();
    case 'toggle': ui.open = ui.open === id ? null : id; return render();
    case 'channel': ui.channel[id] = el.dataset.ch; return render();
    case 'gen': return onGenerate(id);
    case 'open': return onOpen(id);
    case 'copy': {
      const t = msgOf(state.leads[id], chOf(id)).text;
      return toast(t && await copyText(t) ? 'Copiado.' : 'Nada para copiar.');
    }
    case 'sent': {
      const l = state.leads[id];
      l.sentAt = { ...l.sentAt, [chOf(id)]: now() };
      if (l.status === 'Novo') l.status = 'Contatado';
      save();
      return render();
    }
    case 'remove':
      if (confirm('Remover este lead?')) { delete state.leads[id]; ui.open = null; save(); render(); }
      return;
    case 'search': return runSearch(false);
    case 'more': return runSearch(true);
    case 'see':
      ui.tab = 'leads';
      ui.filter = { q: ui.search.niche, status: 'Ativos', noSite: false, mobileOnly: false };
      return render();
    case 'test-gemini':
      try { await geminiText('Responda apenas: ok'); toast('Gemini funcionando.'); } catch (err) { toast(err.message); }
      return;
    case 'export-json':
      return download('prospecta-backup.json', JSON.stringify({ version: 1, leads: leadsArray() }, null, 1), 'application/json');
    case 'export-csv':
      return download('prospecta-leads.csv', '﻿' + toCsv(leadsArray()), 'text/csv;charset=utf-8');
    case 'import-json': return $('#file-json').click();
    case 'import-csv': return $('#file-csv').click();
    case 'wipe':
      if (confirm('Apagar TODOS os leads? Faça um backup antes.')) { state.leads = {}; ui.open = null; save(); render(); }
      return;
  }
}

function handleInput(e) {
  const t = e.target;
  const id = t.dataset.id;
  if (t.matches('[data-msg]')) {
    const l = state.leads[id];
    setMsg(l, chOf(id), { text: t.value });
    save();
    const c = t.parentElement.querySelector('.counter');
    c.textContent = `${t.value.length}/${messageLimit(chOf(id))}`;
    c.classList.toggle('over', t.value.length > messageLimit(chOf(id)));
  } else if (t.matches('[data-subj]')) {
    setMsg(state.leads[id], chOf(id), { subject: t.value });
    save();
  } else if (t.matches('[data-set]')) {
    state.settings[t.dataset.set] = t.value.trim();
    save();
  } else if (t.matches('[data-filter="q"]')) {
    ui.filter.q = t.value;
    const pos = t.selectionStart;
    render();
    const again = $('[data-filter="q"]');
    again.focus();
    again.setSelectionRange(pos, pos);
  }
}

function handleChange(e) {
  const t = e.target;
  const id = t.dataset.id;
  if (t.matches('[data-lf]')) {
    const l = state.leads[id];
    const field = t.dataset.lf;
    l[field] = field === 'instagram' ? cleanHandle(t.value) || t.value.trim() : t.value.trim();
    save();
    if (field === 'status' && isBlocked(l) && ui.filter.status === 'Ativos') {
      ui.open = null;
      toast(`Movido para "${l.status}". Para rever, filtre por Todos.`);
    }
    if (field === 'status' || field === 'instagram') render();
  } else if (t.matches('[data-kind]')) {
    setMsg(state.leads[id], chOf(id), { kind: t.value });
    save();
  } else if (t.matches('[data-filter]') && t.dataset.filter !== 'q') {
    const k = t.dataset.filter;
    ui.filter[k] = t.type === 'checkbox' ? t.checked : t.value;
    render();
  }
}

async function importFile(input, parse) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const leads = parse(await file.text());
    let added = 0;
    for (const l of leads) {
      if (!l?.id || state.leads[l.id]) continue;
      state.leads[l.id] = l;
      added++;
    }
    save();
    render();
    toast(`${added} leads importados (${leads.length - added} já existiam ou eram inválidos).`);
  } catch {
    toast('Arquivo inválido.');
  }
}

document.addEventListener('click', handleClick);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
$('#file-json').addEventListener('change', (e) => importFile(e.target, (t) => {
  const data = JSON.parse(t);
  if (!Array.isArray(data?.leads)) throw new Error('formato');
  return data.leads;
}));
$('#file-csv').addEventListener('change', (e) => importFile(e.target, (t) =>
  parseCsv(t).map((row, i) => leadFromRow(row, i)).filter(Boolean)));

render();
