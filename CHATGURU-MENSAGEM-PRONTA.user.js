// ==UserScript==
// @name         ChatGuru – mensagem pronta
// @namespace    glcapital
// @version      3.3
// @description  F2 abre o menu das mensagens prontas cadastradas no painel (Tampermonkeys › Mensagens do F2)
// @match        https://s12.chatguru.app/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// @downloadURL  https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// ==/UserScript==

(function () {
  'use strict';

  // As mensagens NÃO moram aqui: são cadastradas no painel-dev (Tampermonkeys › Mensagens do F2)
  // e lidas sem login a cada F2. Mudou lá, vale no próximo F2 — sem atualizar este script.
  const LISTA_URL = 'https://gateway-s2.glcapital-ti.net/mensagens-prontas';
  const TECLA_MENU = 'F2';

  // Última lista boa: o F2 abre na hora com ela, e ela segura o menu se o painel cair
  const CACHE_KEY = 'mp_lista';
  // O nome do consultor, digitado uma vez e lembrado neste navegador
  const CONSULTOR_KEY = 'mp_consultor';

  // Placeholder: {chave}. A mesma expressão do painel (PLACEHOLDER em app/mensagens_prontas.py)
  const CHAVE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  // Os que o script preenche sozinho; o consultor confere e pode corrigir. O resto ele digita.
  const AUTOMATICOS = ['nome', 'primeiro_nome', 'consultor', 'saudacao'];
  // Toda chave que começa com "valor" ({valor}, {valor_parcela}…) é dinheiro: o consultor digita
  // o número como quiser e sai "R$ 1.234,56". A mesma regra do painel (DINHEIRO lá).
  const eDinheiro = k => k.startsWith('valor');

  function lerLocal(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }
  function gravarLocal(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) { /* sem storage: só não lembra */ }
  }

  let cache = (() => {
    try { return JSON.parse(lerLocal(CACHE_KEY)) || null; } catch (e) { return null; }
  })();
  let lista = (cache && Array.isArray(cache.mensagens)) ? cache.mensagens : [];
  let menu = null;      // o menu aberto (estado da tela), ou null
  let enviando = false;
  // Enter segurado depois do envio iria para a caixa de texto do ChatGuru e mandaria o rascunho
  let engolirEnterAte = 0;

  async function buscarLista() {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(LISTA_URL, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      const j = await r.json();
      if (!r.ok || !j.ok || !Array.isArray(j.mensagens)) throw new Error(`HTTP ${r.status}`);
      lista = j.mensagens;
      cache = { em: Date.now(), mensagens: lista };
      gravarLocal(CACHE_KEY, JSON.stringify(cache));
      return true;
    } catch (e) {
      console.warn('[mp] não li a lista do painel', e);
      return false;
    } finally {
      clearTimeout(prazo);
    }
  }

  // O chat aberto fica no hash da URL: /chats#69618f93779949b23f3ede4c
  function chatAberto() {
    const id = location.hash.slice(1);
    return /^[0-9a-f]{24}$/i.test(id) ? id : null;
  }

  // Pela tecla física (e.code), não pelo caractere: no Mac o Option+1 digita "¡"
  // e no ABNT2 o AltGr chega como CTRL+ALT, então não dispara o ALT+1.
  function nomeDaTecla(e) {
    const base = e.code ? e.code.replace(/^(Digit|Key|Numpad)/, '') : e.key;
    let prefixo = '';
    if (e.ctrlKey || e.metaKey) prefixo += 'CTRL+';
    if (e.altKey) prefixo += 'ALT+';
    if (e.shiftKey) prefixo += 'SHIFT+';
    return prefixo + base.toUpperCase();
  }

  // ── placeholders ────────────────────────────────────────────────────────────────

  function chavesDe(texto) {
    const vistas = [];
    for (const [, k] of texto.matchAll(CHAVE)) {
      const chave = k.toLowerCase();
      if (!vistas.includes(chave)) vistas.push(chave);
    }
    return vistas;
  }

  function montar(texto) {
    return texto.replace(CHAVE, (bruto, k) => valorFinal(k.toLowerCase()) ?? bruto);
  }

  // Onde o ChatGuru guarda o nome do chat, no objeto de cada cartão da lista
  const CAMPOS_NOME = ['name', 'nome', 'chat_name', 'contact_name', 'nome_contato', 'display_name'];
  const pareceTelefone = s => /^\+?[\d\s().-]{8,}$/.test(s);

  // O nome como pode ir ao lead, ou '' (o consultor digita). Contato novo chega ao ChatGuru como
  // "Novo Contato! Nome:" — isso nunca vai: sobra só o nome que vier depois, se vier (pedido do
  // dono em 25/09/2026). Telefone e texto sem letra também não são nome.
  function limparNome(bruto) {
    const v = String(bruto || '').replace(/\s+/g, ' ').trim()
      .replace(/^novo contato\s*!?\s*(nome\s*:?)?\s*/i, '').trim();
    if (!v || pareceTelefone(v) || !/\p{L}/u.test(v) || /novo contato/i.test(v)) return '';
    return v.slice(0, 80);
  }

  // O nome ATUAL do lead no ChatGuru: o objeto do chat na lista do app Vue do site
  // (window.testeVueJS.cards — o mesmo que o otimizador usa), que o site mantém em dia pelo
  // websocket; renomeou o chat, o próximo F2 já vem com o nome novo.
  function nomeNoApp(chatId) {
    try {
      const cards = window.testeVueJS && window.testeVueJS.cards;
      const card = cards && cards.find && cards.find(c => c && String(c.id) === chatId);
      if (!card) return '';
      for (const k of CAMPOS_NOME) {
        const v = typeof card[k] === 'string' ? limparNome(card[k]) : '';
        if (v) return v;
      }
    } catch (e) { /* o app do ChatGuru mudou de forma: cai para a tela */ }
    return '';
  }

  // O cabeçalho do chat aberto: <span id="chat_name">NOME DO LEAD</span> — o nome como o
  // ChatGuru mostra agora (elemento conferido no ChatGuru pelo dono em 25/09/2026).
  function nomeNoCabecalho() {
    const cabecalho = document.getElementById('chat_name');
    return cabecalho ? limparNome(cabecalho.textContent) : '';
  }

  function nomeDoLead(chatId) {
    return nomeNoCabecalho() || nomeNoApp(chatId) || nomeNaTela(chatId);
  }

  // Plano B: o texto do cartão do chat aberto, na lista da esquerda.
  // ⚠ Leitura da tela do ChatGuru: se o layout mudar, volta vazio e o consultor digita.
  function nomeNaTela(chatId) {
    const link = document.querySelector(`a[href*="${chatId}"]`);
    const cartao = link && (link.closest('.cg__card-container') || link);
    if (!cartao) return '';
    const alvo = cartao.querySelector('[class*="name" i], [class*="nome" i], [class*="title" i], strong, b, h1, h2, h3, h4, h5, h6');
    const linhas = ((alvo || cartao).innerText || '').split('\n').map(s => s.trim());
    // Contato sem nome aparece como telefone: isso não é nome
    return linhas.map(limparNome).find(Boolean) || '';
  }

  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  // "512,3" · "512.30" · "1.234,56" · "1234" · "R$ 1.234,56" → "R$ 1.234,56"; o que não der
  // para ler sem chutar (vazio, letra, "1,234", três casas decimais) → null.
  function emReais(bruto) {
    const s = String(bruto || '').replace(/R\$|\s/gi, '');
    if (!/^\d[\d.,]*$/.test(s)) return null;
    const pontos = s.split('.').length - 1, virgulas = s.split(',').length - 1;
    let inteiro = s, decimal = '';
    if (pontos && virgulas) {                    // o último separador é o decimal
      const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
      inteiro = s.slice(0, sep).replace(/[.,]/g, '');
      decimal = s.slice(sep + 1);
    } else if (virgulas === 1) {                 // 512,30
      [inteiro, decimal] = s.split(',');
    } else if (pontos === 1 && s.split('.')[1].length !== 3) {   // 512.30 (1.234 é milhar)
      [inteiro, decimal] = s.split('.');
    } else if (virgulas > 1 || (pontos && virgulas === 0)) {     // 1.234 · 1.234.567 · 1,234,567
      inteiro = s.replace(/[.,]/g, '');
    }
    if (!/^\d+$/.test(inteiro) || !/^\d{0,2}$/.test(decimal)) return null;
    return BRL.format(Number(`${inteiro}.${decimal || '0'}`)).replace(/\u00a0/g, ' ');
  }

  // O que vai no lugar da chave, ou null se falta (vazio ou valor que não deu para ler)
  function valorFinal(k) {
    const v = (menu.valores[k] || '').trim();
    if (!v) return null;
    return eDinheiro(k) ? emReais(v) : v;
  }

  function primeiroNome(nome) {
    const p = (nome || '').trim().split(/\s+/)[0] || '';
    // "MARIA" e "maria" viram "Maria"; "McDonald" fica como está
    return (p === p.toUpperCase() || p === p.toLowerCase())
      ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p;
  }

  function automaticos(chatId) {
    const h = new Date().getHours();
    const nome = chatId ? nomeDoLead(chatId) : '';
    return {
      saudacao: h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite',
      nome,
      primeiro_nome: primeiroNome(nome),
      consultor: lerLocal(CONSULTOR_KEY) || '',
    };
  }

  // ── o menu ──────────────────────────────────────────────────────────────────────

  const CSS = `
    .fundo { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15,23,42,.45);
      display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh;
      font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .caixa { width: min(640px, 92vw); max-height: 84vh; display: flex; flex-direction: column;
      background: #fff; color: #1e293b; border-radius: 10px; overflow: hidden;
      box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .topo { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; display: grid; gap: 8px; }
    .titulo { font-weight: 600; font-size: 15px; display: flex; align-items: baseline; gap: 8px; }
    .dica { margin-left: auto; color: #94a3b8; font-size: 12px; font-weight: 400; }
    .para { color: #475569; font-size: 12px; }
    .aviso { font-size: 12px; color: #b45309; }
    .aviso:empty { display: none; }
    input { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid #cbd5e1;
      border-radius: 6px; font: inherit; color: inherit; background: #fff; }
    input:focus { outline: 2px solid #128c7e; border-color: transparent; }
    .lista { overflow-y: auto; padding: 6px; }
    .item { padding: 7px 10px; border-radius: 6px; cursor: pointer; }
    .item.sel { background: #e6f4f1; }
    .nome { font-weight: 600; display: flex; gap: 8px; align-items: baseline; }
    .previa { color: #64748b; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tecla { font: 11px ui-monospace, monospace; border: 1px solid #cbd5e1; border-radius: 4px;
      padding: 0 4px; color: #475569; }
    .vazio { padding: 14px 10px; color: #64748b; }
    .campos { padding: 10px 14px 0; display: grid; gap: 8px; }
    label > span { display: block; font-size: 12px; color: #475569; margin-bottom: 2px; }
    .auto { color: #0f766e; }
    .erro { color: #b91c1c; }
    .final { margin: 10px 14px; padding: 10px; background: #f1f5f9; border-radius: 6px;
      white-space: pre-wrap; word-break: break-word; overflow-y: auto; min-height: 3em; }
    .falta { background: #fef3c7; color: #92400e; border-radius: 3px; padding: 0 2px; }
    .rodape { padding: 10px 14px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; align-items: center; }
    .status { flex: 1; font-size: 12px; color: #64748b; }
    .status.erro { color: #b91c1c; }
    button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1;
      background: #fff; color: #1e293b; cursor: pointer; }
    button.enviar { background: #128c7e; color: #fff; border-color: #128c7e; }
    button:disabled { opacity: .5; cursor: default; }
  `;

  function el(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function abrirMenu(direta) {
    const host = el('div');
    const raiz = host.attachShadow({ mode: 'open' });   // o CSS do ChatGuru não entra aqui
    raiz.appendChild(el('style', null, CSS));
    const fundo = el('div', 'fundo');
    const caixa = el('div', 'caixa');
    fundo.appendChild(caixa);
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fecharMenu(); });
    raiz.appendChild(fundo);
    document.body.appendChild(host);
    menu = {
      host, raiz, caixa, chatId: chatAberto(), antes: document.activeElement,
      passo: null, filtro: '', sel: 0, visiveis: [], origem: 'guardada', veioDaLista: !direta,
    };
    if (direta) mostrarFormulario(direta); else mostrarLista();
    buscarLista().then((ok) => {
      if (!menu) return;
      menu.origem = ok ? 'painel' : 'falhou';
      if (menu.passo === 'lista') desenharItens();
    });
  }

  function fecharMenu() {
    if (!menu) return;
    const { host, antes } = menu;
    menu = null;
    host.remove();
    if (antes && antes.focus) antes.focus();
  }

  function mostrarLista() {
    menu.passo = 'lista';
    menu.caixa.replaceChildren();
    const topo = el('div', 'topo');
    const titulo = el('div', 'titulo', 'Mensagens prontas');
    titulo.appendChild(el('span', 'dica', '↑↓ escolhe · Enter abre · Esc fecha'));
    const filtro = el('input');
    filtro.placeholder = 'Filtrar pelo nome ou pelo texto…';
    filtro.value = menu.filtro;
    filtro.addEventListener('input', () => { menu.filtro = filtro.value; menu.sel = 0; desenharItens(); });
    menu.aviso = el('div', 'aviso');
    topo.append(titulo, filtro, menu.aviso);
    menu.listaEl = el('div', 'lista');
    menu.caixa.append(topo, menu.listaEl);
    desenharItens();
    filtro.focus();
  }

  const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function desenharItens() {
    const f = semAcento(menu.filtro.trim());
    menu.visiveis = lista.filter(m => !f || semAcento(`${m.nome} ${m.texto}`).includes(f));
    menu.sel = Math.min(menu.sel, Math.max(menu.visiveis.length - 1, 0));

    const avisos = [];
    if (!menu.chatId) avisos.push('Nenhum chat aberto — dá para ver as mensagens, mas enviar exige um chat aberto.');
    if (menu.origem === 'falhou') {
      avisos.push(cache ? `O painel não respondeu — lista guardada em ${new Date(cache.em).toLocaleString('pt-BR')}.`
                        : 'Não consegui ler a lista do painel.');
    }
    menu.aviso.textContent = avisos.join(' ');

    menu.listaEl.replaceChildren();
    if (!menu.visiveis.length) {
      const vazio = !lista.length
        ? (menu.origem === 'guardada' ? 'Carregando…' : 'Nenhuma mensagem cadastrada no painel (Tampermonkeys › Mensagens do F2).')
        : 'Nada com esse filtro.';
      menu.listaEl.appendChild(el('div', 'vazio', vazio));
      return;
    }
    menu.visiveis.forEach((m, i) => {
      const item = el('div', i === menu.sel ? 'item sel' : 'item');
      const nome = el('div', 'nome', m.nome);
      if (m.tecla) nome.appendChild(el('span', 'tecla', m.tecla));
      item.append(nome, el('div', 'previa', m.texto.replace(/\s+/g, ' ')));
      item.addEventListener('mousemove', () => { if (menu.sel !== i) { menu.sel = i; marcarSelecao(); } });
      item.addEventListener('click', () => mostrarFormulario(m));
      menu.listaEl.appendChild(item);
    });
  }

  function marcarSelecao() {
    [...menu.listaEl.children].forEach((n, i) => n.classList.toggle('sel', i === menu.sel));
    const atual = menu.listaEl.children[menu.sel];
    if (atual) atual.scrollIntoView({ block: 'nearest' });
  }

  function mostrarFormulario(m) {
    menu.passo = 'form';
    menu.atual = m;
    menu.chaves = chavesDe(m.texto);
    const auto = automaticos(menu.chatId);
    menu.valores = {};
    menu.editados = new Set();
    menu.entradas = {};
    menu.dicas = {};
    for (const k of menu.chaves) menu.valores[k] = auto[k] || '';

    menu.caixa.replaceChildren();
    const topo = el('div', 'topo');
    const titulo = el('div', 'titulo', m.nome);
    titulo.appendChild(el('span', 'dica', `Enter envia · Esc ${menu.veioDaLista ? 'volta' : 'fecha'}`));
    const para = el('div', 'para', menu.chatId
      ? `Para: ${auto.nome || 'o chat aberto'} (chat …${menu.chatId.slice(-6)})`
      : 'Nenhum chat aberto — abra um chat para enviar.');
    topo.append(titulo, para);
    menu.caixa.appendChild(topo);

    if (menu.chaves.length) {
      const campos = el('div', 'campos');
      for (const k of menu.chaves) {
        const rotulo = el('label');
        const nome = el('span', null, `{${k}}`);
        if (AUTOMATICOS.includes(k)) {
          nome.appendChild(el('span', 'auto', menu.valores[k]
            ? (k === 'nome' || k === 'primeiro_nome' ? ' · do ChatGuru, confira' : ' · automático, confira')
            : k === 'consultor' ? ' · digite uma vez, fica lembrado' : ' · não achei, digite'));
        }
        // Dinheiro: a dica mostra como vai sair (desenharFinal a atualiza)
        if (eDinheiro(k)) nome.appendChild(menu.dicas[k] = el('span', 'auto'));
        const entrada = el('input');
        if (eDinheiro(k)) entrada.inputMode = 'decimal';
        entrada.value = menu.valores[k];
        entrada.addEventListener('input', () => {
          menu.valores[k] = entrada.value;
          menu.editados.add(k);
          // Corrigiu o nome: o primeiro nome acompanha, se ninguém mexeu nele
          if (k === 'nome' && 'primeiro_nome' in menu.valores && !menu.editados.has('primeiro_nome')) {
            menu.valores.primeiro_nome = primeiroNome(entrada.value);
            menu.entradas.primeiro_nome.value = menu.valores.primeiro_nome;
          }
          desenharFinal();
        });
        menu.entradas[k] = entrada;
        rotulo.append(nome, entrada);
        campos.appendChild(rotulo);
      }
      menu.caixa.appendChild(campos);
    }

    menu.final = el('div', 'final');
    menu.caixa.appendChild(menu.final);

    const rodape = el('div', 'rodape');
    menu.status = el('div', 'status');
    const voltar = el('button', null, menu.veioDaLista ? 'Voltar' : 'Fechar');
    voltar.addEventListener('click', () => (menu.veioDaLista ? mostrarLista() : fecharMenu()));
    menu.botao = el('button', 'enviar', 'Enviar');
    menu.botao.addEventListener('click', enviar);
    rodape.append(menu.status, voltar, menu.botao);
    menu.caixa.appendChild(rodape);

    desenharFinal();
    const vazia = menu.chaves.find(k => !menu.valores[k]);
    (vazia ? menu.entradas[vazia] : menu.botao).focus();
  }

  // O texto como vai sair; o que falta preencher aparece marcado
  function desenharFinal() {
    menu.final.replaceChildren();
    let pos = 0;
    for (const achado of menu.atual.texto.matchAll(CHAVE)) {
      menu.final.append(menu.atual.texto.slice(pos, achado.index));
      const valor = valorFinal(achado[1].toLowerCase());
      menu.final.append(valor !== null ? valor : el('span', 'falta', achado[0]));
      pos = achado.index + achado[0].length;
    }
    menu.final.append(menu.atual.texto.slice(pos));
    for (const [k, dica] of Object.entries(menu.dicas)) {
      const v = valorFinal(k);
      dica.textContent = v !== null ? ` · sai como ${v}` : menu.valores[k].trim() ? ' · não entendi o valor' : ' · em reais';
      dica.className = v === null && menu.valores[k].trim() ? 'erro' : 'auto';
    }
    const faltam = faltando();
    const ilegiveis = faltam.filter(k => menu.valores[k].trim());
    const vazios = faltam.filter(k => !menu.valores[k].trim());
    menu.botao.disabled = !podeEnviar();
    avisar([vazios.length ? `Falta preencher: ${vazios.map(k => `{${k}}`).join(', ')}` : '',
            ilegiveis.length ? `Valor que não entendi: ${ilegiveis.map(k => `{${k}}`).join(', ')} (ex.: 1.234,56)` : '']
      .filter(Boolean).join(' · '), ilegiveis.length > 0);
  }

  const faltando = () => menu.chaves.filter(k => valorFinal(k) === null);
  const podeEnviar = () => !enviando && !!menu.chatId && !faltando().length;

  function avisar(texto, erro) {
    menu.status.textContent = texto;
    menu.status.classList.toggle('erro', !!erro);
  }

  async function enviar() {
    if (!menu || menu.passo !== 'form' || enviando || menu.botao.disabled) return;
    if (chatAberto() !== menu.chatId) return avisar('O chat aberto mudou — feche (Esc) e abra o F2 de novo.', true);
    const texto = montar(menu.atual.texto);
    const atual = menu;
    enviando = true;
    atual.botao.disabled = true;
    avisar('Enviando…');
    try {
      const r = await fetch('/messages/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          chat_id: atual.chatId,
          message: texto,
          reply_msg_id: '',
          send_datetime: '',
        }),
      });
      const resposta = await r.text();
      console.log('[mp] POST /messages/', r.status, r.url, resposta);
      // Sessão vencida: o ChatGuru redireciona para /login e devolve 200 com a página
      if (r.redirected || r.url.includes('/login')) {
        if (menu === atual) avisar('Mensagem NÃO enviada: sessão expirada. Entre de novo no ChatGuru.', true);
      } else if (!r.ok) {
        if (menu === atual) avisar(`Mensagem NÃO enviada: erro ${r.status}.`, true);
      } else {
        if (atual.valores.consultor) gravarLocal(CONSULTOR_KEY, atual.valores.consultor.trim());
        engolirEnterAte = Date.now() + 600;
        if (menu === atual) fecharMenu();   // a mensagem aparece no próprio chat
      }
    } catch (e) {
      console.error('[mp] POST /messages/ falhou', e);
      if (menu === atual) avisar('Erro de rede — confira no chat se a mensagem saiu antes de enviar de novo.', true);
    } finally {
      enviando = false;
      // Só o botão: redesenhar apagaria o erro que acabou de aparecer
      if (menu === atual) atual.botao.disabled = !podeEnviar();
    }
  }

  // ── o teclado ───────────────────────────────────────────────────────────────────

  function parar(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // Com o menu aberto, NENHUMA tecla chega ao ChatGuru nem aos BINDS (senão um F3 aqui
  // dispararia um diálogo). Digitar continua funcionando: parar a propagação não cancela a tecla.
  function teclaNoMenu(e) {
    e.stopImmediatePropagation();
    const nome = nomeDaTecla(e);
    if (nome === TECLA_MENU) {
      parar(e);
      if (!e.repeat) fecharMenu();   // F2 segurado não fecha o menu que acabou de abrir
      return;
    }
    if (e.key === 'Escape') {
      parar(e);
      return menu.passo === 'form' && menu.veioDaLista ? mostrarLista() : fecharMenu();
    }
    if (e.key === 'Tab') {
      // O foco fica no menu: fora dele, o que se digitasse iria para o ChatGuru, atrás
      const focaveis = [...menu.raiz.querySelectorAll('input, button:not(:disabled)')];
      const n = focaveis.length;
      if (n) {
        parar(e);
        const i = focaveis.indexOf(menu.raiz.activeElement);
        focaveis[((i < 0 ? -1 : i) + (e.shiftKey ? n - 1 : 1) + n) % n].focus();
      }
      return;
    }
    if (menu.passo === 'lista') {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        parar(e);
        const n = menu.visiveis.length;
        if (n) { menu.sel = (menu.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; marcarSelecao(); }
      } else if (e.key === 'Enter') {
        parar(e);
        if (menu.visiveis[menu.sel]) mostrarFormulario(menu.visiveis[menu.sel]);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Enter num botão é o clique dele (Voltar/Fechar); no resto, envia
      if (e.composedPath()[0] instanceof HTMLButtonElement) return;
      parar(e);
      enviar();
    }
  }

  // Na captura da WINDOW: roda antes dos BINDS, que ouvem na captura do document —
  // é o que tira o F2 deles (fluxo fgts, apresentação) enquanto este script estiver instalado.
  window.addEventListener('keydown', (e) => {
    if (menu) return teclaNoMenu(e);
    if (e.key === 'Enter' && Date.now() < engolirEnterAte) return parar(e);
    const nome = nomeDaTecla(e);
    if (nome === TECLA_MENU) {
      parar(e);
      if (!e.repeat) abrirMenu();
      return;
    }
    const direta = lista.find(m => m.tecla && m.tecla === nome);
    if (direta) {
      parar(e);
      if (!e.repeat) abrirMenu(direta);
    }
  }, true);
  for (const tipo of ['keypress', 'keyup']) {
    window.addEventListener(tipo, (e) => { if (menu) e.stopImmediatePropagation(); }, true);
  }

  buscarLista();   // já na carga: os atalhos diretos dependem da lista
})();
