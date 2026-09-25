// CHATGURU-LIGAR-BOT — o código de verdade do userscript CHATGURU-LIGAR-BOT.user.js, que agora é só o carregador.
// Editou aqui: rode `python3 assinar.py` no s2 e suba codigo/ na main. Sem assinatura, os
// PCs seguem na versão anterior. Roda no escopo da página do ChatGuru.

(function () {
  'use strict';

  // ===================== CONFIG =====================
  const CFG = {
    ESTADO: true,                                        // true = liga o bot
    USUARIO_ALVO: 'Guilherme de Matos Borges Medeiros',  // nome a marcar no dropdown de usuário
    MAX_PESSOAS: 200,                                    // máx. de usuários/conversas por ciclo
    DELAY_MS: 3000,                                      // pausa entre chats
    TENTATIVAS_BOT: 3,                                   // retentativas do toggle
    BUSCAR_NO_DROPDOWN: true,                            // digita o nome no "Pesquisar" do dropdown
    DELAY_CHECAGEM: 1500,                                // pausa entre CLICAR e CHECAR se marcou (arquivados/usuário)
    TENTATIVAS_FILTRO: 5,                                // vezes que tenta garantir o filtro antes de recarregar
    MARCAR_ARQUIVADOS: 1,                                // 0 = não marca/verifica arquivados | 1 = marca e verifica os arquivados
    ORDENAR_POR: 1,                                      // 0 = não mexe | 1 = Data Criação (Mais Novo) | 2 = Data Criação (Mais Antigo)
  };
  const LOOP_KEY = 'cg_sweep_loop_ativo';                // persiste o loop entre F5
  // ==================================================

  let rodando = false;
  let debugUsuario = '';   // último motivo da checagem de usuário (mostrado na tela)

  // ---------------- utilitários ----------------
  const dormir       = ms => new Promise(r => setTimeout(r, ms));
  const getChatId    = () => location.hash.replace('#', '').trim();
  const loopAtivo    = () => localStorage.getItem(LOOP_KEY) === '1';
  const chaveCard    = c => c.getAttribute('href') || c.dataset?.chatId || (c.textContent || '').trim().slice(0, 60);
  const txt          = e => (e && e.textContent ? e.textContent.trim().replace(/\s+/g, ' ') : '');
  const visivel      = e => !!(e && e.offsetParent !== null && e.getClientRects().length);
  const cssEsc       = s => (window.CSS && CSS.escape) ? CSS.escape(s) : s;
  const primeiroNome = n => (n || '').split(' ')[0];

  function rotulo(el) {
    if (!el) return '';
    if (el.id) { const l = document.querySelector('label[for="' + cssEsc(el.id) + '"]'); if (l) return txt(l); }
    const p = el.closest && el.closest('label'); if (p) return txt(p);
    const c = el.closest && el.closest('div,li,td,th'); return c ? txt(c).slice(0, 80) : '';
  }

  function clicarReal(el) {
    if (!el) return;
    const ev = t => { try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {} };
    ev('pointerdown'); ev('mousedown'); ev('mouseup'); try { el.click(); } catch (e) {}
  }

  function estaMarcado(el) {
    if (!el) return false;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return el.checked;
    if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
    if (/(\bchecked\b|\bselected\b|\bactive\b|\bativo\b|\bmarcado\b)/i.test(el.className || '')) return true;
    const inner = el.querySelector && el.querySelector('input[type="checkbox"]');
    if (inner) return inner.checked;
    return false;
  }

  function melhorClicavel(input) {
    if (input.id) { const l = document.querySelector('label[for="' + cssEsc(input.id) + '"]'); if (l && visivel(l)) return l; }
    const lab = input.closest('label'); if (lab && visivel(lab)) return lab;
    const wrap = input.closest('li,div'); if (wrap && visivel(wrap)) return wrap;
    return input;
  }

  // marca se ainda não estiver marcado. Retorna 'ja-marcado' | 'marcado'
  function marcarSeNecessario(el) {
    if (estaMarcado(el)) return 'ja-marcado';
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      const clic = melhorClicavel(el);
      clicarReal(clic || el);
      if (!el.checked) clicarReal(el);
    } else {
      clicarReal(el);
    }
    return 'marcado';
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }

  function acharPorTexto(textos, exato = false) {
    const alvos = textos.map(s => s.toLowerCase());
    let best = null, bestLen = Infinity;
    for (const e of document.querySelectorAll('button,a,span,div,li,label,[role="button"]')) {
      if (!visivel(e)) continue;
      const t = txt(e).toLowerCase();
      if (!t) continue;
      const casa = exato ? alvos.includes(t) : alvos.some(x => t === x || t.includes(x));
      if (casa && t.length < bestLen) { best = e; bestLen = t.length; }
    }
    return best;
  }

  function esperarSeletor(sel, timeout = 25000) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      (function check() {
        const el = document.querySelector(sel);
        if (el) return res(el);
        if (Date.now() - t0 > timeout) return rej(new Error('timeout esperando ' + sel));
        setTimeout(check, 300);
      })();
    });
  }

  function acharContainerLista() {
    const first = document.querySelector('.cg__card-container');
    if (!first) return null;
    let el = first.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ---------- liga o bot e confirma 200, com retentativa ----------
  async function ligarBotConfirmado(chatId) {
    for (let t = 0; t < CFG.TENTATIVAS_BOT; t++) {
      try {
        const r = await fetch(`https://s12.chatguru.app/chat/toggle_bot_status/${chatId}/${CFG.ESTADO}`,
          { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' }, body: null, credentials: 'same-origin' });
        if (r.ok) return true;
      } catch (e) { console.error('[loop] bot erro', e); }
      await dormir(500);
    }
    return false;
  }

  // ================= FILTRO (busca por nome/ícone) =================
  function garantirFiltrosVisiveis() {
    const temCb = [...document.querySelectorAll('input[type="checkbox"]')].length > 0;
    if (!temCb) { const b = acharPorTexto(['mostrar filtros', 'exibir filtros', 'filtros'], false); if (b) clicarReal(b); }
  }

  function acharSidebar() {
    const anchor = acharPorTexto(['esconder filtros'], false) || acharPorTexto(['limpar filtros'], false);
    let el = anchor;
    for (let i = 0; i < 10 && el; i++) {
      const t = (el.textContent || '').toLowerCase();
      if (t.includes('tags') && t.includes('nome')) return el;
      el = el.parentElement;
    }
    return anchor ? (anchor.closest('div') || document.body) : document.body;
  }

  // ---- ARQUIVADOS: 2ª caixinha da fileira de ícones (retângulo azul) ----
  function acharCheckboxArquivar() {
    const sidebar = acharSidebar();
    // 1) ícone/elemento com "arquiv/archive" em title/aria/classe/href
    const marca = [...sidebar.querySelectorAll('[title],[aria-label],i,svg,use,span,label,div')].find(e => {
      const attrs = ((e.getAttribute && (e.getAttribute('title') || '')) || '') + ' ' +
        ((e.getAttribute && (e.getAttribute('aria-label') || '')) || '') + ' ' +
        (typeof e.className === 'string' ? e.className : '') + ' ' +
        ((e.getAttribute && (e.getAttribute('href') || e.getAttribute('xlink:href') || '')) || '');
      return /arquiv|archive/i.test(attrs);
    });
    if (marca) {
      const cont = marca.closest('label,li,div');
      const cb = (cont && cont.querySelector('input[type="checkbox"]')) || (marca.querySelector && marca.querySelector('input[type="checkbox"]'));
      if (cb) return cb;
      return cont || marca;
    }
    // 2) posicional: 2ª checkbox do grupo de ícones (dropdown fechado => só existem as de ícone)
    const cbs = [...sidebar.querySelectorAll('input[type="checkbox"]')];
    if (cbs.length >= 2) return cbs[1]; // envelope[0], ARQUIVAR[1], broadcast[2], estrela[3], relógio[4]
    return null;
  }

  // retorna 'ja-marcado' | 'marcado' | 'nao-achei'
  function marcarArquivados() {
    const cb = acharCheckboxArquivar();
    if (!cb) return 'nao-achei';
    const r = marcarSeNecessario(cb);
    console.log('[loop] arquivados:', r);
    return r;
  }

  // ---- USUÁRIO: campo "Usuário/Departamento:" (retângulo vermelho) ----
  function acharCampoUsuario() {
    // por placeholder/aria em inputs
    let el = [...document.querySelectorAll('input,textarea,select')].find(i =>
      visivel(i) && /usu[aá]rio|departamento/i.test((i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '')));
    if (el) return el;
    // por texto próprio ("Usuário/Departamento:")
    const cands = [...document.querySelectorAll('div,span,button,label')].filter(e =>
      visivel(e) && /usu[aá]rio\s*\/?\s*departamento/i.test(txt(e)) && txt(e).length < 45);
    cands.sort((a, b) => txt(a).length - txt(b).length);
    if (cands[0]) return cands[0];
    // fallback amplo
    return [...document.querySelectorAll('div,span,button,label,input')].find(e =>
      visivel(e) && /usu[aá]rio|departamento/i.test(txt(e) || e.placeholder || '') && ((txt(e) || e.placeholder || '').length < 45)) || null;
  }

  function acharBuscaDropdown() {
    return [...document.querySelectorAll('input')].find(i =>
      visivel(i) && /pesquisar|buscar|search/i.test(i.placeholder || '') && !/mensagem/i.test(i.placeholder || ''));
  }

  function acharAlvoUsuario(nome) {
    const alvo = nome.toLowerCase();
    const inp = [...document.querySelectorAll('input[type="checkbox"]')].find(c => rotulo(c).toLowerCase().includes(alvo));
    if (inp) return inp;
    const itens = [...document.querySelectorAll('label,li,div,span')]
      .filter(e => visivel(e) && txt(e).toLowerCase().includes(alvo) && txt(e).length < 120);
    itens.sort((a, b) => txt(a).length - txt(b).length);
    return itens[0] || null;
  }

  // CONFIRMA a seleção do usuário: quando marcado, o campo exibe o NOME (some o rótulo
  // "Usuário/Departamento:"). Procuramos o nome APENAS DENTRO DA COLUNA DE FILTROS — assim
  // NÃO importa qual usuário está logado no cabeçalho (funciona em qualquer conta/PC).
  function usuarioJaSelecionado(nome) {
    const alvoCurto = nome.toLowerCase().split(' ').slice(0, 4).join(' '); // robusto a truncamento (ex.: "guilherme de matos borges")
    const escopo = acharSidebar() || document;                // coluna de filtros (nunca inclui o cabeçalho da conta)
    for (const e of escopo.querySelectorAll('input,span,div,button,label')) {
      if (!visivel(e)) continue;                              // SÓ visível (campo azul) — ignora opções escondidas do dropdown
      const t = ((e.value || '') + ' ' + (e.textContent || '')).trim().replace(/\s+/g, ' ');
      if (!t || t.length >= 70) continue;                     // só o campo (texto curto)
      if (/\bcred\b|\|/i.test(t)) continue;                   // reforço: se o cabeçalho cair no escopo, ele tem "Cred"/"|"
      if (t.toLowerCase().includes(alvoCurto)) { debugUsuario = 'campo mostra "' + t.slice(0, 55) + '"'; return true; }
    }
    debugUsuario = 'campo do usuário SEM o nome (vazio)';
    return false;
  }

  async function abrirDropdownUsuario() {
    const campo = acharCampoUsuario();
    if (!campo) return null;
    const box = campo.closest('div') || campo;
    for (const alvo of [campo, box]) {
      clicarReal(alvo);
      if (alvo.focus) { try { alvo.focus(); } catch (e) {} }
      await dormir(450);
      if (acharBuscaDropdown() || acharAlvoUsuario(CFG.USUARIO_ALVO)) return campo;
    }
    return campo;
  }

  // retorna 'ja-marcado' | 'marcado' | 'nao-achei'
  async function selecionarUsuario(nome) {
    // SEMPRE executa a lógica original de abrir/buscar/marcar (a checagem fica só na confirmação).
    const campo = await abrirDropdownUsuario();
    if (!campo) return 'nao-achei';
    await dormir(400);
    if (CFG.BUSCAR_NO_DROPDOWN) {
      const busca = acharBuscaDropdown();
      if (busca) { busca.focus(); setNativeValue(busca, nome); busca.dispatchEvent(new Event('input', { bubbles: true })); await dormir(700); }
    }
    const alvo = acharAlvoUsuario(nome);
    if (!alvo) { fecharDropdown(); return 'nao-achei'; }
    const r = marcarSeNecessario(alvo);
    await dormir(300);
    fecharDropdown();
    console.log('[loop] usuario:', r);
    return r;
  }

  function fecharDropdown() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
    try { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.body.click(); } catch (e) {}
  }

  const rotuloStatus = s => s === 'ja-marcado' ? 'já marcado ✅' : s === 'marcado' ? 'marcado agora ✅' : 'NÃO ACHEI ⚠';

  // ---- CHECAGEM DUPLA: aplica, confirma e remarca se preciso (idempotente e seguro) ----
  function arquivadosConfirmado() {
    if (CFG.MARCAR_ARQUIVADOS !== 1) return true;   // desligado => não bloqueia (igual ao ORDENAR_POR = 0)
    return estaMarcado(acharCheckboxArquivar());
  }

  // 'aplicar' e 'confirmar' são funções; roda a marcação, confirma, e remarca enquanto não confirmar.
  async function garantirComChecagem(nome, aplicar, confirmar, tentativas = 3, espera = 800) {
    let status = await aplicar();                  // 1ª marcação
    await dormir(espera);
    let confirmado = confirmar();
    let t = 1;
    while (!confirmado && t < tentativas) {         // remarca enquanto não confirmar
      console.log(`[loop] ${nome}: não confirmado — remarcando (${t + 1}/${tentativas})`);
      status = await aplicar();
      await dormir(espera);
      confirmado = confirmar();
      t++;
    }
    if (confirmado) {                               // 2ª verificação (a "checagem dupla")
      await dormir(350);
      if (!confirmar()) {                           // se oscilou p/ desmarcado, remarca 1x
        console.log(`[loop] ${nome}: oscilou na checagem dupla — remarcando`);
        status = await aplicar();
        await dormir(espera);
        confirmado = confirmar();
      }
    }
    console.log(`[loop] ${nome}: ${confirmado ? 'CONFIRMADO' : 'FALHOU'} (${status})`);
    return { status, confirmado };
  }

  // ---- ORDENAR POR: define e confirma a ordenação (Data Criação Novo/Antigo) ----
  function palavrasOrdenacao(modo) {
    if (modo === 1) return t => /cria/.test(t) && /novo/.test(t);   // Data Criação (↓ Mais Novo)
    if (modo === 2) return t => /cria/.test(t) && /antig/.test(t);  // Data Criação (↑ Mais Antigos)
    return null;                                                    // 0/qualquer outro => não mexe
  }

  function acharSelectOrdenar() {
    return [...document.querySelectorAll('select')].find(s => {
      const opts = [...s.options].map(o => (o.textContent || '').toLowerCase()).join(' | ');
      return /ordenar por/.test(opts) || (/data cria/.test(opts) && /atualiza/.test(opts));
    }) || null;
  }

  // retorna 'ok' | 'tentou' | 'nao-achei' | 'desligado'
  async function definirOrdenacao(modo) {
    const quer = palavrasOrdenacao(modo);
    if (!quer) return 'desligado';
    // A) <select> nativo
    const sel = acharSelectOrdenar();
    if (sel) {
      const opt = [...sel.options].find(o => quer((o.textContent || '').toLowerCase()));
      if (opt) {
        if (sel.value !== opt.value) {
          setNativeValue(sel, opt.value);            // seta via setter nativo (React percebe a mudança)
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return ordenacaoConfirmada(modo) ? 'ok' : 'tentou';
      }
    }
    // B) dropdown customizado (clica no gatilho "Ordenar Por" e na opção)
    const trig = acharPorTexto(['ordenar por'], false);
    if (trig) {
      clicarReal(trig);
      await dormir(500);
      const opt = [...document.querySelectorAll('li,[role="option"],option,div,span,a')]
        .find(e => visivel(e) && quer(txt(e).toLowerCase()) && txt(e).length < 60);
      if (opt) { clicarReal(opt); await dormir(300); fecharDropdown(); return ordenacaoConfirmada(modo) ? 'ok' : 'tentou'; }
      fecharDropdown();
    }
    return 'nao-achei';
  }

  function ordenacaoConfirmada(modo) {
    const quer = palavrasOrdenacao(modo);
    if (!quer) return true;   // desligado => não bloqueia
    // A) select nativo: a opção selecionada bate?
    const sel = acharSelectOrdenar();
    if (sel && sel.options[sel.selectedIndex] && quer((sel.options[sel.selectedIndex].textContent || '').toLowerCase())) return true;
    // B) custom: a caixa de exibição (div/span/button) mostra o texto da opção escolhida.
    // NÃO consultamos <select>/<option> aqui: o <select> nativo já foi tratado em (A) pelo selectedIndex,
    // e o texto de um <select> contém TODAS as opções (daria falso positivo).
    const escopo = acharSidebar() || document;
    return [...escopo.querySelectorAll('div,span,button,a,li')]
      .some(e => visivel(e) && quer(txt(e).toLowerCase()) && txt(e).length < 60);
  }

  // Aplica em ETAPAS: arquivados -> usuário -> ordenação. Só passa de etapa quando a anterior
  // confirma, e só retorna sucesso quando TODAS confirmarem. Repete até TENTATIVAS_FILTRO.
  async function aplicarFiltro() {
    garantirFiltrosVisiveis();
    await dormir(300);

    let arq = null, usr = null, ord = null;
    for (let tent = 1; tent <= CFG.TENTATIVAS_FILTRO; tent++) {
      // ETAPA 1 — Arquivados (não avança sem confirmar) — só se CFG.MARCAR_ARQUIVADOS === 1
      if (CFG.MARCAR_ARQUIVADOS === 1) {
        arq = await garantirComChecagem('arquivados', () => marcarArquivados(), arquivadosConfirmado, 2, CFG.DELAY_CHECAGEM);
        if (!arq.confirmado) { avisar(`Arquivados não confirmou (tentativa ${tent}/${CFG.TENTATIVAS_FILTRO}) — repetindo...`); await dormir(500); continue; }
      }

      // ETAPA 2 — Usuário Guilherme. O DELAY entre clicar e checar está embutido (CFG.DELAY_CHECAGEM).
      usr = await garantirComChecagem('usuario', () => selecionarUsuario(CFG.USUARIO_ALVO), () => usuarioJaSelecionado(CFG.USUARIO_ALVO), 2, CFG.DELAY_CHECAGEM);
      if (!usr.confirmado) { avisar(`Usuário não confirmou (tentativa ${tent}/${CFG.TENTATIVAS_FILTRO}) — repetindo...`); await dormir(500); continue; }

      // ETAPA 3 — Ordenar Por (só se CFG.ORDENAR_POR for 1 ou 2)
      ord = await garantirComChecagem('ordenacao', () => definirOrdenacao(CFG.ORDENAR_POR), () => ordenacaoConfirmada(CFG.ORDENAR_POR), 2, CFG.DELAY_CHECAGEM);
      if (!ord.confirmado) { avisar(`Ordenação não confirmou (tentativa ${tent}/${CFG.TENTATIVAS_FILTRO}) — repetindo...`); await dormir(500); continue; }

      // Reconfirma que arquivados e usuário continuam ok depois de mexer nas outras etapas
      await dormir(CFG.DELAY_CHECAGEM);
      if (!arquivadosConfirmado()) { avisar('Arquivados desmarcou — repetindo o filtro...'); await dormir(500); continue; }
      if (!usuarioJaSelecionado(CFG.USUARIO_ALVO)) { avisar('Usuário desmarcou — repetindo o filtro...'); await dormir(500); continue; }

      break; // TODAS as etapas confirmadas
    }

    const arqOk = arquivadosConfirmado();
    const usrOk = usuarioJaSelecionado(CFG.USUARIO_ALVO);
    const ordOk = ordenacaoConfirmada(CFG.ORDENAR_POR);
    const rot = (ok, c) => !ok ? 'FALHOU ⚠' : (c && c.status === 'ja-marcado' ? 'já marcado ✅' : 'ok ✅');
    const arqMsg = CFG.MARCAR_ARQUIVADOS === 1 ? rot(arqOk, arq) : 'off';
    const ordTxt = CFG.ORDENAR_POR === 1 ? 'Criação↓Novo' : CFG.ORDENAR_POR === 2 ? 'Criação↑Antigo' : 'off';
    const ordMsg = (CFG.ORDENAR_POR === 1 || CFG.ORDENAR_POR === 2) ? (ordOk ? 'ok ✅' : 'FALHOU ⚠') : '—';
    avisar(`Filtro → Arquiv: ${arqMsg} · Usuário: ${rot(usrOk, usr)} · Ordenar(${ordTxt}): ${ordMsg} · [${debugUsuario}]`);
    return { arq: arqOk, usr: usrOk, ord: ordOk };
  }

  // ---------- carrega até MAX_PESSOAS (rolando) e liga o bot ----------
  async function carregarEProcessar() {
    rodando = true;
    const processados = new Set();
    let ok = 0, falha = 0, semNovos = 0;
    const container = acharContainerLista();

    while (rodando && processados.size < CFG.MAX_PESSOAS) {
      const cards = [...document.querySelectorAll('.cg__card-container a')];
      const pendentes = cards.filter(c => !processados.has(chaveCard(c)));

      if (pendentes.length === 0) {
        if (container) container.scrollTop = container.scrollHeight;   // rola pra carregar mais
        await dormir(900);
        const depois = document.querySelectorAll('.cg__card-container a').length;
        if (depois <= cards.length) { if (++semNovos >= 3) break; } else { semNovos = 0; }
        continue;
      }
      semNovos = 0;

      for (const card of pendentes) {
        if (!rodando || processados.size >= CFG.MAX_PESSOAS) break;
        processados.add(chaveCard(card));

        card.click();                 // abre o chat
        await dormir(500);
        const id = getChatId();

        if (!id) { falha++; avisar(status(processados.size, ok, falha, 'sem id')); await dormir(CFG.DELAY_MS); continue; }

        const botOk = await ligarBotConfirmado(id);
        if (!botOk) { falha++; avisar(status(processados.size, ok, falha, 'bot falhou')); await dormir(CFG.DELAY_MS); continue; }

        ok++;
        avisar(status(processados.size, ok, falha, 'ok'));
        await dormir(CFG.DELAY_MS);
      }
    }

    rodando = false;
    return { ok, falha, total: processados.size };
  }

  // ---------- 1 ciclo: filtro -> processa até 200 -> F5 ----------
  async function cicloContinuo() {
    try {
      await esperarSeletor('.cg__card-container', 25000).catch(() => {});
      avisar('Aplicando filtro (arquivados + usuário)...');
      const ok = await aplicarFiltro();

      // GATE: só varre se TODAS as etapas anteriores estiverem confirmadas (arquivados + usuário + ordenação)
      if (!ok.arq || !ok.usr || !ok.ord) {
        const falhas = (parseInt(sessionStorage.getItem('cg_falhas_filtro') || '0', 10) || 0) + 1;
        sessionStorage.setItem('cg_falhas_filtro', String(falhas));
        avisar(`Filtro incompleto (Arq:${ok.arq ? 'ok' : 'x'} · Usr:${ok.usr ? 'ok' : 'x'} · Ord:${ok.ord ? 'ok' : 'x'}). NÃO vou varrer. Tentativa ${falhas}/5.`);
        if (!loopAtivo()) return;
        if (falhas >= 5) {
          avisar('Filtro falhou 5x seguidas — parando o loop. Confira a tela e reinicie.');
          localStorage.removeItem(LOOP_KEY); pintarBotao();
          return;
        }
        await dormir(1500);
        location.reload();                    // recarrega e tenta aplicar o filtro de novo
        return;
      }
      sessionStorage.removeItem('cg_falhas_filtro');   // filtro confirmado: zera contador

      await dormir(1200);
      await esperarSeletor('.cg__card-container', 25000).catch(() => {});

      const r = await carregarEProcessar();
      avisar(`Lote: ok:${r.ok} | falha:${r.falha} | total:${r.total}. ${loopAtivo() ? 'Recarregando (F5)...' : 'Parado.'}`);
      console.log(`[loop] lote ok:${r.ok} falha:${r.falha} total:${r.total}`);

      if (!loopAtivo()) return;               // usuário clicou PARAR
      await dormir(1200);
      location.reload();                      // == F5; o script reinicia o ciclo sozinho
    } catch (e) {
      console.error('[loop] ciclo erro', e);
      avisar('Erro no ciclo: ' + e.message + ' — abra o console (F12) e me avise.');
    }
  }

  const status = (n, ok, fb, etapa) => `Usuário ${n}/${CFG.MAX_PESSOAS} [${etapa}] · ok:${ok} fBot:${fb}`;

  // ===================== UI =====================
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999,
    background: '#1a7f37', color: '#fff', border: 'none',
    padding: '10px 16px', borderRadius: '8px', font: '14px sans-serif', cursor: 'pointer',
  });
  function pintarBotao() {
    btn.textContent = loopAtivo() ? 'PARAR LOOP' : 'INICIAR LOOP (200)';
    btn.style.background = loopAtivo() ? '#b42318' : '#1a7f37';
  }
  btn.onclick = () => {
    if (loopAtivo()) {
      localStorage.removeItem(LOOP_KEY); rodando = false; pintarBotao();
      avisar('Loop parado pelo usuário.');
    } else {
      localStorage.setItem(LOOP_KEY, '1'); pintarBotao(); cicloContinuo();
    }
  };
  document.body.appendChild(btn);
  pintarBotao();

  function avisar(t) {
    let el = document.getElementById('cg-sweep-aviso');
    if (!el) {
      el = document.createElement('div'); el.id = 'cg-sweep-aviso';
      Object.assign(el.style, {
        position: 'fixed', bottom: '70px', right: '20px', zIndex: 99999,
        background: '#222', color: '#fff', padding: '8px 14px', borderRadius: '8px',
        font: '13px sans-serif', maxWidth: '360px',
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
    console.log('[loop]', t);
  }

  // ---------- auto-retoma o loop após o F5 ----------
  if (loopAtivo()) {
    avisar('Loop ativo — retomando após recarregar...');
    cicloContinuo();
  }
})();
