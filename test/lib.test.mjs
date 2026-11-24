import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBrPhone, formatPhone, waLink, cleanHandle, igProfileLink, igSearchLink, placeToLead,
  buildPrompt, cleanModelText, parseEmailOutput, parseCsv, toCsv, leadFromRow, newLead, mailtoLink, siteState, parseSiteInput, ensureLink,
} from '../lib.js';

test('telefone: celular com DDD, com e sem 55', () => {
  for (const raw of ['(19) 99876-5432', '19998765432', '+55 19 99876-5432', '0 19 99876 5432', '5519998765432']) {
    const n = normalizeBrPhone(raw);
    assert.equal(n.e164, '5519998765432', raw);
    assert.equal(n.isMobile, true, raw);
  }
});

test('telefone: fixo não é celular; DDD 55 com 11 dígitos não perde dígitos', () => {
  assert.deepEqual(normalizeBrPhone('(19) 3234-5678'), { e164: '551932345678', national: '1932345678', isMobile: false });
  assert.equal(normalizeBrPhone('(55) 99876-5432').e164, '5555998765432');
});

test('telefone: inválidos', () => {
  for (const raw of ['', 'abc', '12345', '(05) 99876-5432', '0800 123 4567 89']) {
    assert.equal(normalizeBrPhone(raw), null, raw);
  }
});

test('formatPhone', () => {
  assert.equal(formatPhone('19998765432'), '(19) 99876-5432');
  assert.equal(formatPhone('1932345678'), '(19) 3234-5678');
});

test('links', () => {
  assert.equal(waLink('5519998765432', 'Olá, tudo bem?'), 'https://wa.me/5519998765432?text=Ol%C3%A1%2C%20tudo%20bem%3F');
  assert.equal(waLink('5519998765432'), 'https://wa.me/5519998765432');
  assert.match(mailtoLink('a@b.com', 'Oi', 'Corpo & mais'), /^mailto:a@b\.com\?subject=Oi&body=Corpo%20%26%20mais$/);
  assert.match(igSearchLink('Studio X', 'Campinas'), /site%3Ainstagram\.com/);
});

test('instagram: handle', () => {
  assert.equal(cleanHandle('@Studio.X'), 'studio.x');
  assert.equal(cleanHandle('https://www.instagram.com/studio.x/?hl=pt'), 'studio.x');
  assert.equal(cleanHandle('não é um handle!'), '');
  assert.equal(igProfileLink('@abc'), 'https://www.instagram.com/abc/');
  assert.equal(igProfileLink(''), '');
});

test('placeToLead', () => {
  const l = placeToLead({
    id: 'ChIJ1', displayName: { text: 'Studio X' }, nationalPhoneNumber: '(19) 99876-5432',
    formattedAddress: 'Rua A, 1 - Centro, Campinas - SP, Brasil', rating: 4.8, userRatingCount: 120,
    googleMapsUri: 'https://maps.google.com/?cid=1',
  }, { niche: 'salão', city: 'Campinas' });
  assert.equal(l.id, 'ChIJ1');
  assert.equal(l.name, 'Studio X');
  assert.equal(l.website, '');
  assert.equal(l.address, 'Rua A, 1 - Centro, Campinas - SP');
  assert.equal(l.status, 'Novo');
  assert.equal(l.niche, 'salão');
});

test('prompt: regras e fatos corretos por cenário', () => {
  const seller = { name: 'Vini', offer: 'landing pages', link: 'https://exemplo.com' };
  const semSite = newLead({ name: 'Studio X', niche: 'salão', city: 'Campinas', rating: 4.8, ratingCount: 120 });
  const p = buildPrompt({ seller, lead: semSite, channel: 'whatsapp' });
  assert.match(p, /não mostra site/);
  assert.match(p, /4\.8 \(120 avaliações\)/);
  assert.match(p, /PRIMEIRO contato/);
  assert.match(p, /NUNCA invente/);
  assert.match(p, /não envia mais mensagens/);
  assert.match(p, /https:\/\/exemplo\.com/);

  const comSite = newLead({ name: 'Y', website: 'https://y.com', rating: 3.9, ratingCount: 5 });
  const p2 = buildPrompt({ seller, lead: comSite, channel: 'email', kind: 'followup' });
  assert.match(p2, /Site atual: https:\/\/y\.com/);
  assert.doesNotMatch(p2, /Avaliação no Google/);
  assert.match(p2, /FOLLOW-UP/);
  assert.match(p2, /ASSUNTO:/);
});

test('saída do modelo', () => {
  assert.equal(cleanModelText('```\nOlá!\n```'), 'Olá!');
  assert.equal(cleanModelText('"Olá, tudo bem?"'), 'Olá, tudo bem?');
  assert.equal(cleanModelText('Mensagem: Oi'), 'Oi');
  assert.deepEqual(parseEmailOutput('ASSUNTO: Ideia rápida\n\nOlá, Studio X.'), { subject: 'Ideia rápida', body: 'Olá, Studio X.' });
  assert.deepEqual(parseEmailOutput('Sem assunto aqui'), { subject: '', body: 'Sem assunto aqui' });
});

test('csv: aspas, ponto e vírgula, acentos no cabeçalho', () => {
  const rows = parseCsv('Nome;Telefone;Endereço\n"Studio ""X""; Hair";(19) 99876-5432;"Rua A, 1"\n\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].nome, 'Studio "X"; Hair');
  assert.equal(rows[0].endereco, 'Rua A, 1');
});

test('csv: ida e volta', () => {
  const l = newLead({ id: 'a', name: 'Café, "Bom"', phone: '(19) 3234-5678', website: '', niche: 'café', city: 'Campinas', rating: 4.5 });
  const back = parseCsv(toCsv([l]));
  assert.equal(back[0].nome, 'Café, "Bom"');
  const lead = leadFromRow(back[0], 0);
  assert.equal(lead.name, 'Café, "Bom"');
  assert.equal(lead.rating, 4.5);
  assert.equal(lead.status, 'Novo');
});

test('leadFromRow: sem nome é ignorado; instagram é limpo', () => {
  assert.equal(leadFromRow({ telefone: '1' }), null);
  assert.equal(leadFromRow({ name: 'A', instagram: 'https://instagram.com/Abc/' }, 3).instagram, 'abc');
});

test('site: tem / sem / não verificado', () => {
  assert.equal(siteState(newLead({ website: 'https://a.com' })), 'has');
  assert.equal(siteState(newLead()), 'none');
  assert.equal(siteState(newLead({ siteUnknown: true })), 'unknown');
  assert.deepEqual(parseSiteInput(''), { website: '', siteUnknown: true });
  assert.deepEqual(parseSiteInput('Sem'), { website: '', siteUnknown: false });
  assert.deepEqual(parseSiteInput('não'), { website: '', siteUnknown: false });
  assert.deepEqual(parseSiteInput('negocio.com.br'), { website: 'https://negocio.com.br', siteUnknown: false });
  assert.deepEqual(parseSiteInput('?'), { website: '', siteUnknown: true });
});

test('csv: coluna site vazia = não verificado; "sem" = sem site; ida e volta preserva', () => {
  const rows = parseCsv('nome,telefone,site\nA,(19) 99876-5432,\nB,(19) 99876-5433,sem\nC,(19) 99876-5434,c.com.br\n');
  const [a, b, c] = rows.map((r, i) => leadFromRow(r, i));
  assert.equal(siteState(a), 'unknown');
  assert.equal(siteState(b), 'none');
  assert.equal(siteState(c), 'has');
  const back = parseCsv(toCsv([a, b, c])).map((r, i) => leadFromRow(r, i));
  assert.deepEqual(back.map(siteState), ['unknown', 'none', 'has']);
});

test('prompt: site não verificado não afirma nada sobre site', () => {
  const p = buildPrompt({ seller: { name: 'Vini' }, lead: newLead({ name: 'X', siteUnknown: true }), channel: 'whatsapp' });
  assert.match(p, /NÃO afirme nem sugira que não tem/);
  assert.doesNotMatch(p, /não mostra site/);
});

test('link do portfólio entra no prompt e é garantido na mensagem', () => {
  const p = buildPrompt({ seller: { name: 'Vini', link: 'https://x.github.io/p/' }, lead: newLead({ name: 'X' }), channel: 'whatsapp' });
  assert.match(p, /Inclua o link do portfólio/);
  assert.match(ensureLink('Oi!', 'https://x.github.io/p/'), /https:\/\/x\.github\.io\/p\//);
  assert.equal(ensureLink('Oi https://a.b', 'https://a.b'), 'Oi https://a.b');
  assert.equal(ensureLink('Oi', ''), 'Oi');
});
