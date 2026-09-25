// chatguru-otimizador — o código de verdade do userscript chatguru-otimizador.user.js, que agora é só o carregador.
// Editou aqui: rode `python3 assinar.py` no s2 e suba codigo/ na main. Sem assinatura, os
// PCs seguem na versão anterior. Roda no escopo da página do ChatGuru.

(function () {
  'use strict';
  if (window.top !== window) return;
  if (window.__cgTurbo) {
    console.warn('[CG-Turbo] outra cópia ou versão do ChatGuru Turbo já está ativa. Desative a antiga no Tampermonkey.');
    return;
  }

  const VERSION = '2.1.2';
  const TAG = '[CG-Turbo]';

  // ============================ CONFIGURAÇÃO ============================
  // Para mudar sem editar o arquivo, no console do ChatGuru (F12):
  //   __cgTurbo.setConfig({ maxCards: 500 })   e recarregue a página.
  //   __cgTurbo.resetConfig()                  volta aos padrões abaixo.
  const DEFAULTS = {
    blockTrackers: true,      // Clarity, Google Tag Manager/Analytics/Ads, Facebook, LinkedIn, HubSpot, Beamer, Userflow
    keepSupportChat: false,   // true = mantém o chat de suporte do HubSpot
    prodMode: true,           // Vue da lista em modo produção (o site publica o Vue em modo desenvolvimento)
    fixUpdateCard: true,      // não re-renderiza todos os cards a cada evento; só os afetados
    skipIndexChurn: true,     // card que só mudou de posição na lista não é redesenhado
    batchMs: 1000,            // em uso: aplica os eventos da lista no máximo 1x por segundo
    idleBatchMs: 3000,        // sem mexer no mouse/teclado há idleAfterMs: 1x a cada 3 s (0 = igual a batchMs)
    idleAfterMs: 120000,      // tempo sem interação para contar como inativo
    hiddenBatchMs: 30000,     // aba oculta: 1x a cada 30 s, e na hora em que você volta (0 = igual a batchMs)
    maxQueue: 5000,           // teto da fila de eventos pendentes (mínimo 500)
    maxCards: 300,            // teto da lista de chats (0 = sem teto; mínimo 100). Cresce quando você rola a lista
    pageSize: 100,            // chats por página no servidor do ChatGuru
    memoDates: true,          // cacheia o cálculo "há X minutos" por minuto
    lazyCards: true,          // cards fora da tela não são desenhados
    lazyImages: true,         // avatares da lista só carregam quando aparecem
    debounceResizeMs: 150,    // redimensionar a janela recalcula o layout 1x em vez de dezenas (0 = desliga)
    fixScroll: true,          // a página e o contêiner das colunas não rolam no lugar da lista
    log: true,
  };
  // limites aceitos para os números (valores fora são corrigidos)
  const RANGES = {
    batchMs: [0, 60000], idleBatchMs: [0, 600000], idleAfterMs: [5000, 3600000], hiddenBatchMs: [0, 600000],
    maxQueue: [500, 100000], maxCards: [0, 20000], pageSize: [10, 1000], debounceResizeMs: [0, 2000],
  };
  // ======================================================================

  const CFG_KEY = 'cgTurbo.cfg';
  function normalize(k, v) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, k)) return { ok: false, why: 'opção desconhecida' };
    const d = DEFAULTS[k];
    if (typeof d === 'boolean') {
      if (typeof v !== 'boolean') return { ok: false, why: 'use true ou false' };
      return { ok: true, v };
    }
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) return { ok: false, why: 'use um número' };
    let x = Math.floor(n);
    const r = RANGES[k];
    if (r) x = Math.min(r[1], Math.max(r[0], x));
    if (k === 'maxCards' && x > 0 && x < 100) x = 100;
    return { ok: true, v: x };
  }

  const CFG = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(saved)) {
        const r = normalize(k, saved[k]);
        if (r.ok) CFG[k] = r.v;
      }
    }
  } catch (_) { /* localStorage indisponível: usa os padrões */ }

  const log = (...a) => { if (CFG.log) console.info(TAG, ...a); };
  const stats = {
    version: VERSION, mode: '', prodMode: 'off', blocked: [], errors: [],
    events: 0, flushes: 0, applied: 0, badEvents: 0, flushMs: 0, flushByMode: {}, sched: 'active',
    dropped: 0, trimmed: 0, trimSkipped: 0, maxSeenCards: 0, pageBumps: 0, reconnects: 0,
    dateHits: 0, dateMiss: 0, lazyImgs: 0, resizesHeld: 0, resizesFired: 0,
    instRebuilds: 0, indexFixed: 0, forwardSyncs: 0, scrollFixes: 0, scrollContained: 0,
  };
  const api = {
    CFG, stats,
    setConfig(obj) {
      if (!obj || typeof obj !== 'object') { console.warn(TAG, 'use __cgTurbo.setConfig({ opção: valor })'); return; }
      let cur = {};
      try { cur = JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (_) { /* ignore */ }
      const applied = {};
      for (const k of Object.keys(obj)) {
        const r = normalize(k, obj[k]);
        if (!r.ok) { console.warn(TAG, 'ignorado "' + k + '": ' + r.why); continue; }
        if (r.v !== obj[k]) console.warn(TAG, '"' + k + '" ajustado para ' + r.v);
        cur[k] = r.v; applied[k] = r.v;
      }
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(cur));
        console.info(TAG, 'configuração salva:', applied, '— recarregue a página para aplicar');
      } catch (e) { console.warn(TAG, 'não consegui salvar a configuração', e); }
    },
    resetConfig() {
      try { localStorage.removeItem(CFG_KEY); console.info(TAG, 'configuração padrão restaurada; recarregue a página'); } catch (_) { /* ignore */ }
    },
    dump() {
      const s = Object.assign({}, stats, {
        blocked: stats.blocked.length, errors: stats.errors.join(', ') || '-',
        flushByMode: JSON.stringify(stats.flushByMode),
        avgFlushMs: stats.flushes ? +(stats.flushMs / stats.flushes).toFixed(1) : 0,
      });
      console.table(s);
      return s;
    },
  };
  window.__cgTurbo = api;

  // Cada otimização roda isolada: se uma falhar, as outras continuam.
  function safe(name, fn) {
    try { return fn(); } catch (e) { stats.errors.push(name); console.warn(TAG, name + ' falhou', e); }
  }

  // executa cb assim que <head> existir (document-start pode rodar antes do <html>)
  function whenHead(cb) {
    if (document.head) { cb(); return; }
    const mo = new MutationObserver(() => { if (document.head) { mo.disconnect(); cb(); } });
    mo.observe(document, { childList: true, subtree: true });
  }

  // Se o Tampermonkey injetar tarde (depois do app já rodar), algumas coisas não se aplicam.
  const LATE = document.readyState !== 'loading' || !!window.CGChatList || !!window.testeVueJS;

  // ---------------------------------------------------------------------
  // 1. Vue em modo produção
  //    O bundle da lista (app.chatlist.js) foi compilado com os "process.env"
  //    trocados por objetos vazios ({}), então todo teste NODE_ENV!=="production"
  //    é verdadeiro: validação de props, avisos e proxies extras a cada render.
  //    Uma propriedade NODE_ENV="production" não enumerável em Object.prototype
  //    faz esses objetos vazios herdarem o valor certo. Medido: DOM idêntico,
  //    re-render da lista ~35% mais barato.
  // ---------------------------------------------------------------------
  safe('prodMode', () => {
    if (!CFG.prodMode) return;
    if (LATE) { stats.prodMode = 'skipped-late'; return; } // trocar de modo com o app rodando não é seguro
    if (Object.prototype.hasOwnProperty.call(Object.prototype, 'NODE_ENV')) return;
    Object.defineProperty(Object.prototype, 'NODE_ENV', {
      value: 'production', writable: true, configurable: true, enumerable: false,
    });
    stats.prodMode = 'on';
  });

  // ---------------------------------------------------------------------
  // 2. Bloqueio de scripts de terceiros (rastreadores e widgets)
  // ---------------------------------------------------------------------
  const BLOCK = [];
  if (CFG.blockTrackers) {
    BLOCK.push(
      /clarity\.ms/i,
      /googletagmanager\.com/i,
      /google-analytics\.com/i,
      /googleadservices\.com|doubleclick\.net|googlesyndication\.com/i,
      /connect\.facebook\.net|facebook\.com\/tr/i,
      /licdn\.com|ads\.linkedin\.com/i,
      /hs-analytics\.net|hs-banner\.com|hubspotfeedback\.com|hsadspixel\.net|hscollectedforms\.net|hsforms\.net/i,
      /getbeamer\.com/i,
      /userflow\.com/i
    );
    if (!CFG.keepSupportChat) BLOCK.push(/hs-scripts\.com|usemessages\.com|hubspot\.com/i);
  }
  const isBlocked = (url) => !!url && BLOCK.some((re) => re.test(String(url)));

  function neutralize(el, url) {
    try {
      el.type = 'text/blocked';
      el.removeAttribute('src');
      el.setAttribute('data-cg-blocked', String(url).slice(0, 120));
    } catch (_) { /* ignore */ }
    if (stats.blocked.length < 200) stats.blocked.push(String(url).slice(0, 90));
  }

  if (BLOCK.length) {
    // (a) scripts criados por JS (GTM, Clarity, HubSpot, Userflow...)
    safe('bloqueio:src', () => {
      const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
      if (srcDesc && srcDesc.set) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
          configurable: true,
          enumerable: srcDesc.enumerable,
          get() { return srcDesc.get.call(this); },
          set(v) { if (isBlocked(v)) { neutralize(this, v); return; } srcDesc.set.call(this, v); },
        });
      }
      const origSetAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this instanceof HTMLScriptElement && String(name).toLowerCase() === 'src' && isBlocked(value)) {
          neutralize(this, value);
          return;
        }
        return origSetAttribute.call(this, name, value);
      };
    });

    // (b) scripts/iframes/links que vêm no HTML: remove antes de executar.
    //     Durante a carga observa o documento inteiro; depois do "load" passa a
    //     olhar só os filhos diretos de <head> e <body>, que é onde os scripts
    //     injetados por JS aparecem. Assim a lista de chats, que muda o tempo
    //     todo, não gera trabalho para este observador.
    safe('bloqueio:observer', () => {
      const scan = (records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            const tag = n.tagName;
            if (tag === 'SCRIPT') {
              const u = n.getAttribute('src');
              if (isBlocked(u)) { neutralize(n, u); n.remove(); }
            } else if (tag === 'IFRAME' && isBlocked(n.getAttribute('src'))) {
              n.remove();
            } else if (tag === 'LINK' && isBlocked(n.getAttribute('href'))) {
              n.remove();
            }
          }
        }
      };
      const blockObserver = new MutationObserver(scan);
      const downgrade = () => safe('bloqueio:downgrade', () => {
        scan(blockObserver.takeRecords());
        blockObserver.disconnect();
        if (document.head) blockObserver.observe(document.head, { childList: true });
        if (document.body) blockObserver.observe(document.body, { childList: true });
      });
      if (document.readyState === 'complete') { downgrade(); return; }
      blockObserver.observe(document, { childList: true, subtree: true });
      window.addEventListener('load', downgrade, { once: true });
    });

    // (c) Firefox executa scripts do HTML mesmo removidos; este evento só existe lá
    safe('bloqueio:firefox', () => {
      document.addEventListener('beforescriptexecute', (e) => {
        const s = e.target;
        const u = s && (s.getAttribute('src') || s.getAttribute('data-cg-blocked'));
        if (u && isBlocked(u)) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    });

    // (d) globais inertes para os snippets inline do site não quebrarem
    safe('bloqueio:stubs', () => {
      const noop = function () {};
      const chain = () => { const f = function () { return f; }; return f; };
      const stubs = {
        userflow: new Proxy({}, { get: (t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : () => Promise.resolve()) }),
        Beamer: { init: noop, update: noop, show: noop, hide: noop, destroy: noop, forceButtonUpdate: noop, setNotificationHandler: noop },
        lintrk: chain(),
      };
      if (!CFG.keepSupportChat) {
        stubs.HubSpotConversations = {
          widget: { load: noop, open: noop, close: noop, remove: noop, refresh: noop, status: () => ({ loaded: false }) },
          on: noop, off: noop, clear: noop, resetAndReloadWidget: noop,
        };
      }
      for (const k of Object.keys(stubs)) {
        try { if (!(k in window)) window[k] = stubs[k]; } catch (_) { /* ignore */ }
      }
    });
  }

  // ---------------------------------------------------------------------
  // 3. CSS: cards fora da tela não são desenhados
  // ---------------------------------------------------------------------
  if (CFG.lazyCards) {
    safe('css', () => whenHead(() => {
      const style = document.createElement('style');
      style.id = 'cg-turbo-css';
      style.textContent = '#cg-chatlist .cg__card-container{content-visibility:auto;contain-intrinsic-size:auto 68px;}';
      document.head.appendChild(style);
    }));
  }

  // ---------------------------------------------------------------------
  // 4. Avatares da lista com loading=lazy (observa só a lista, não a página)
  // ---------------------------------------------------------------------
  if (CFG.lazyImages) {
    safe('lazyImages', () => {
      const lazify = (img) => {
        if (!img.hasAttribute('loading')) { img.setAttribute('loading', 'lazy'); img.setAttribute('decoding', 'async'); stats.lazyImgs++; }
      };
      const attach = (list) => {
        const imgs = list.getElementsByTagName('img');
        for (let i = 0; i < imgs.length; i++) lazify(imgs[i]);
        new MutationObserver((records) => {
          for (const r of records) {
            for (const n of r.addedNodes) {
              if (n.nodeType !== 1) continue;
              if (n.tagName === 'IMG') { lazify(n); continue; }
              if (n.firstElementChild) {
                const inner = n.getElementsByTagName('img');
                for (let i = 0; i < inner.length; i++) lazify(inner[i]);
              }
            }
          }
        }).observe(list, { childList: true, subtree: true });
      };
      const found = document.getElementById('cg-chatlist');
      if (found) { attach(found); return; }
      if (document.readyState === 'complete') return; // página sem lista de chats
      const boot = new MutationObserver(() => {
        const el = document.getElementById('cg-chatlist');
        if (el) { boot.disconnect(); attach(el); }
      });
      boot.observe(document, { childList: true, subtree: true });
      window.addEventListener('load', () => { if (!document.getElementById('cg-chatlist')) boot.disconnect(); }, { once: true });
    });
  }

  // ---------------------------------------------------------------------
  // 5. Resize: o app chama fix_sizes() (layout forçado + popover em centenas de
  //    elementos) a CADA evento de resize. Segura os eventos e repassa 1 só
  //    quando a janela para de mudar de tamanho.
  // ---------------------------------------------------------------------
  if (CFG.debounceResizeMs > 0) {
    safe('resize', () => {
      const FLAG = '__cgTurboResize';
      let pending = 0;
      window.addEventListener('resize', function (e) {
        if (e[FLAG]) return;
        e.stopImmediatePropagation();
        stats.resizesHeld++;
        clearTimeout(pending);
        pending = setTimeout(() => {
          const ev = new Event('resize');
          ev[FLAG] = true;
          stats.resizesFired++;
          window.dispatchEvent(ev);
        }, CFG.debounceResizeMs);
      }, true);
    });
  }

  // ---------------------------------------------------------------------
  // 5b. Rolagem no contêiner errado
  //    A tela de chats cabe na janela (o app calcula as alturas), mas às vezes a
  //    página inteira ou o contêiner das três colunas fica rolado: o topo dos
  //    filtros some e sobra uma faixa vazia embaixo da conversa.
  //    (a) a lista/conversa que chega ao fim não repassa a rolagem para a página.
  //        Só o rolador mais externo de cada coluna recebe overscroll-behavior:
  //        contain. Aplicado em todos os elementos (1.1), qualquer coisa que rola
  //        dentro de uma mensagem (conteúdo largo, caixinha com rolagem, 1 px de
  //        sobra) segurava a roda e a conversa não andava;
  //    (b) se a página ou um contêiner overflow:hidden acima da lista rolar
  //        mesmo assim, volta para 0.
  // ---------------------------------------------------------------------
  if (CFG.fixScroll) {
    const CONTAIN = 'data-cg-contain';
    safe('scroll:css', () => whenHead(() => {
      const style = document.createElement('style');
      style.id = 'cg-turbo-scroll-css';
      style.textContent = 'html:has(#cg-chatlist) [' + CONTAIN + ']{overscroll-behavior:contain;}';
      document.head.appendChild(style);
    }));
    safe('scroll:contain', () => {
      const canScroll = (o) => o === 'auto' || o === 'scroll' || o === 'overlay';
      const cache = new WeakMap(); // elemento -> overflow auto/scroll?
      const isScroller = (el) => {
        let v = cache.get(el);
        if (v === undefined) {
          const st = getComputedStyle(el);
          v = canScroll(st.overflowY) || canScroll(st.overflowX);
          cache.set(el, v);
        }
        return v;
      };
      // Sobe do alvo até o contêiner que abraça a lista (ou o body) e marca o
      // último rolador do caminho: a coluna. Os de dentro continuam repassando
      // a rolagem para ela.
      const mark = (e) => {
        const list = document.getElementById('cg-chatlist');
        if (!list) return;
        let top = null;
        for (let el = e.target; el && el.nodeType === 1 && el !== document.body && el !== document.documentElement; el = el.parentElement) {
          if (el.hasAttribute(CONTAIN)) return;
          if (el.contains(list)) break;
          if (isScroller(el)) top = el;
        }
        if (!top) return;
        top.setAttribute(CONTAIN, '');
        stats.scrollContained++;
      };
      ['wheel', 'touchstart', 'pointerdown'].forEach((ev) =>
        window.addEventListener(ev, (e) => safe('scroll:mark', () => mark(e)), { capture: true, passive: true }));
    });
    safe('scroll:guard', () => {
      let cacheList = null;
      let cache = new WeakMap(); // elemento -> deve ficar sem rolagem?
      const isLayoutClip = (el, list) => {
        if (cacheList !== list) { cacheList = list; cache = new WeakMap(); }
        let v = cache.get(el);
        if (v === undefined) {
          const st = getComputedStyle(el);
          const clip = (o) => o === 'hidden' || o === 'clip';
          v = el.contains(list) && (clip(st.overflowY) || clip(st.overflowX));
          cache.set(el, v);
        }
        return v;
      };
      let pending = null;
      const reset = (el) => {
        if (pending && pending.indexOf(el) >= 0) return;
        if (!pending) {
          pending = [];
          requestAnimationFrame(() => {
            const els = pending; pending = null;
            for (const x of els) {
              if (!x.scrollTop && !x.scrollLeft) continue;
              x.scrollTop = 0; x.scrollLeft = 0;
              if (!stats.scrollFixes) log('rolagem fora do lugar corrigida em', x);
              stats.scrollFixes++;
            }
          });
        }
        pending.push(el);
      };
      document.addEventListener('scroll', (e) => {
        const list = document.getElementById('cg-chatlist');
        if (!list) return; // outras telas do ChatGuru rolam a página normalmente
        const t = e.target;
        if (t === document || t === document.documentElement || t === document.body) {
          reset(document.scrollingElement || document.documentElement);
          if (document.body) reset(document.body);
        } else if (t && t.nodeType === 1 && isLayoutClip(t, list)) {
          reset(t);
        }
      }, { capture: true, passive: true });
    });
  }

  // ---------------------------------------------------------------------
  // 6. Patches no app Vue da lista de chats (window.testeVueJS)
  // ---------------------------------------------------------------------
  // Percorre a árvore de componentes. fn(inst) pode devolver true (parar) ou 'skip' (não descer).
  function walkTree(vnode, fn, depth) {
    depth = depth || 0;
    if (!vnode || depth > 40) return;
    if (vnode.component) {
      const r = fn(vnode.component);
      if (r === true) return true;
      if (r !== 'skip' && walkTree(vnode.component.subTree, fn, depth + 1) === true) return true;
    }
    const ch = vnode.children;
    if (Array.isArray(ch)) {
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        if (c && typeof c === 'object' && walkTree(c, fn, depth + 1) === true) return true;
      }
    }
  }

  function getCardDef(root) {
    return root.$options && root.$options.components && root.$options.components.Card;
  }

  // Aplica fn nas opções do Card e na cópia mesclada que o Vue guarda em cache (se houver).
  function patchCardOptions(root, Card, fn) {
    fn(Card);
    try {
      const merged = root.$.appContext.optionsCache.get(Card);
      if (merged && merged !== Card) fn(merged);
    } catch (_) { /* ignore */ }
  }

  // Acrescenta um hook de ciclo de vida às opções do Card sem perder o original.
  function addHook(opts, name, fn, after) {
    const cur = opts[name];
    if (Array.isArray(cur)) { if (after) cur.push(fn); else cur.unshift(fn); return; }
    if (typeof cur === 'function') {
      opts[name] = after
        ? function () { const r = cur.apply(this, arguments); try { fn.call(this); } catch (_) { /* ignore */ } return r; }
        : function () { try { fn.call(this); } catch (_) { /* ignore */ } return cur.apply(this, arguments); };
      return;
    }
    opts[name] = fn;
  }

  function patchDateCalc(root) {
    if (!CFG.memoDates) return;
    const Card = getCardDef(root);
    if (!Card || !Card.methods || typeof Card.methods.dateCalc !== 'function') { log('Card.dateCalc não encontrado; cache de datas desativado'); return; }
    const orig = Card.methods.dateCalc;
    if (orig.__cgTurbo) return;
    const cache = new Map();
    let bucket = -1;
    const memo = function (date, tz) {
      const b = Math.floor(Date.now() / 60000);
      if (b !== bucket) { cache.clear(); bucket = b; }
      const key = date + '|' + tz;
      const hit = cache.get(key);
      if (hit) { stats.dateHits++; this.hours = hit.h; return hit.v; }
      stats.dateMiss++;
      const v = orig.call(this, date, tz);
      cache.set(key, { v, h: this.hours });
      return v;
    };
    memo.__cgTurbo = true;
    patchCardOptions(root, Card, (o) => { if (o.methods) o.methods.dateCalc = memo; });
    walkTree(root.$.subTree, (inst) => {
      if (inst.type === Card) {
        try { inst.ctx.dateCalc = memo.bind(inst.proxy); } catch (_) { /* ignore */ }
        return 'skip';
      }
    });
    log('cache de datas instalado');
  }

  // A raiz passa "index" (posição na lista) para cada Card, mas o Card não usa
  // essa prop. Toda vez que um chat sobe para o topo, os de baixo mudam de
  // posição e o Vue redesenharia cada um à toa. Fixar index=0 nos vnodes recém
  // criados faz o Vue ver "nada mudou" nesses cards.
  function patchIndexChurn(root) {
    if (!CFG.skipIndexChurn) return;
    const Card = getCardDef(root);
    const inst = root.$;
    const orig = inst && inst.render;
    if (!Card || typeof orig !== 'function' || orig.__cgTurbo) { log('render da lista não encontrado; posição dos cards continua sendo redesenhada'); return; }
    const src = Card.props ? Object.keys(Card.props) : [];
    if (src.indexOf('index') < 0) return;
    // prova de que o template do Card não lê "index"
    const cardRender = Card.render ? Function.prototype.toString.call(Card.render) : '';
    if (!cardRender || /\.index\b/.test(cardRender)) { log('o Card passou a usar "index"; otimização de posição desligada'); return; }
    let fixed = 0;
    const fix = (vnode, depth) => {
      const ch = vnode && vnode.children;
      if (!Array.isArray(ch) || depth > 60) return;
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i];
        if (!c || typeof c !== 'object') continue;
        if (c.type === Card) {
          if (c.props && typeof c.props.index === 'number' && c.props.index !== 0) { c.props.index = 0; fixed++; }
          continue;
        }
        fix(c, depth + 1);
      }
    };
    const wrapped = function () {
      const vn = orig.apply(this, arguments);
      try { fixed = 0; fix(vn, 0); stats.indexFixed += fixed; } catch (_) { /* ignore */ }
      return vn;
    };
    wrapped.__cgTurbo = true;
    inst.render = wrapped;
    log('cards que só mudam de posição não são mais redesenhados');
  }

  function patchUpdateCard(root) {
    const bound = root.updateCard;
    if (typeof bound !== 'function') { log('updateCard não encontrado; nada a fazer'); return; }
    if (bound.__cgTurbo) return;

    const methods = (root.$options && root.$options.methods) || {};
    const rawSrc = methods.updateCard ? Function.prototype.toString.call(methods.updateCard) : '';
    const removers = [...rawSrc.matchAll(/this\.(removeBecauseOf\w+)/g)].map((m) => m[1]);
    const canReplicate = CFG.fixUpdateCard && removers.length > 0 && rawSrc.includes('webSocketInput') &&
      typeof root.orderRefresh === 'function' && typeof root.orderByDate === 'function' && Array.isArray(root.cards);
    stats.mode = canReplicate ? 'batch+targeted' : 'batch-only';
    if (!canReplicate) log('updateCard tem formato desconhecido nesta versão do site; aplicando só o agrupamento de eventos');

    const Card = getCardDef(root);
    const wsWatch = Card && Card.watch && Card.watch.webSocket;
    const wsHandler = typeof wsWatch === 'function' ? wsWatch : (wsWatch && wsWatch.handler);
    const store = root.$store;
    const storeState = () => (store && store.state) || {};

    // ---- registro id -> instância do Card, mantido pelo próprio ciclo de vida do Card
    const instCache = new Map();
    if (Card) {
      patchCardOptions(root, Card, (o) => {
        addHook(o, 'mounted', function () {
          const c = this.$props && this.$props.card;
          if (c && c.id != null) instCache.set(c.id, this.$);
        }, true);
        addHook(o, 'unmounted', function () {
          const c = this.$props && this.$props.card;
          if (c && instCache.get(c.id) === this.$) instCache.delete(c.id);
        }, false);
      });
    }
    function rebuildInstCache() {
      instCache.clear();
      stats.instRebuilds++;
      walkTree(root.$.subTree, (inst) => {
        if (inst.type === Card) {
          const c = inst.props && inst.props.card;
          if (c && c.id != null) instCache.set(c.id, inst);
          return 'skip';
        }
      });
    }
    function findInst(id) {
      const inst = instCache.get(id);
      if (inst && !inst.isUnmounted && inst.props && inst.props.card && inst.props.card.id === id) return inst;
      if (inst) instCache.delete(id);
      return null;
    }
    rebuildInstCache(); // cards que já existiam antes do patch

    // ---- modo encaminhar: o Card só sincroniza a caixinha (selectCheckbox) com o
    //      store no hook updated(). O site original redesenhava todos os cards a
    //      cada evento, e isso mantinha as caixinhas certas por tabela. Aqui,
    //      "Selecionar todos" e "limpar" forçam essa sincronização explicitamente.
    if (store && typeof store.subscribe === 'function') {
      store.subscribe((m) => {
        if (!m || (m.type !== 'selectAll' && m.type !== 'clear' && m.type !== 'setCanForward')) return;
        stats.forwardSyncs++;
        walkTree(root.$.subTree, (inst) => {
          if (inst.type === Card) { try { inst.proxy.$forceUpdate(); } catch (_) { /* ignore */ } return 'skip'; }
        });
      });
    } else {
      log('store do Vuex não encontrado; sincronização do modo encaminhar indisponível');
    }

    function shouldRemove(e) {
      for (let i = 0; i < removers.length; i++) {
        const fn = root[removers[i]];
        if (typeof fn === 'function' && fn(e)) return true;
      }
      return false;
    }

    // ---- teto da lista
    //  - só com ordenação decrescente por data (o fim da lista são os chats mais antigos);
    //  - nunca no modo encaminhar, nunca onde você está rolando;
    //  - protege o chat aberto e os marcados;
    //  - depois do corte, a próxima rolagem busca a página do servidor que começa no corte.
    let pageBumpDelta = 0; // quantas páginas o teto avançou além da rolagem real do usuário
    function capList() {
      const cards = root.cards;
      const rawArr = (cards && cards.__v_raw) || cards;
      if (!rawArr) return;
      if (rawArr.length > stats.maxSeenCards) stats.maxSeenCards = rawArr.length;
      if (!(CFG.maxCards > 0)) return;
      const page = Math.max(0, root.page | 0);
      const limit = Math.max(CFG.maxCards, (page + 1) * CFG.pageSize);
      if (rawArr.length <= limit + CFG.pageSize) return; // folga: não apara a cada lote
      const ds = String((root.fields && root.fields.dateSearch) || '');
      if (ds && (ds[0] !== '-' || ds.indexOf('new_messages') >= 0)) { stats.trimSkipped++; return; }
      const st = storeState();
      if (st.canForward) { stats.trimSkipped++; return; }
      const wrap = document.querySelector('#cg-chatlist .list__cards-wrapper');
      if (wrap && wrap.scrollTop + wrap.clientHeight > (limit - 20) * 68) { stats.trimSkipped++; return; }
      const protect = new Set();
      if (root.idSelected) protect.add(String(root.idSelected));
      if (st.chat_ids && st.chat_ids.length) for (let i = 0; i < st.chat_ids.length; i++) protect.add(String(st.chat_ids[i]));
      const keepTail = [];
      for (let i = limit; i < rawArr.length; i++) if (protect.has(String(rawArr[i].id))) keepTail.push(rawArr[i]);
      const removedCount = rawArr.length - limit - keepTail.length;
      cards.splice(limit, rawArr.length - limit, ...keepTail); // in-place: não dispara o watcher "cards" do site
      stats.trimmed += removedCount;
      const coveredPage = Math.ceil(limit / CFG.pageSize) - 1;
      if (page < coveredPage) {
        pageBumpDelta += coveredPage - page;
        root.page = coveredPage;
        stats.pageBumps++;
      }
      if (root.hiddenObserver === false) root.hiddenObserver = true; // reativa a paginação por rolagem
    }

    // Quando um filtro recarrega a lista do zero, desconta da página o avanço feito
    // pelo teto, deixando o número que o site teria só com a rolagem do usuário.
    safe('patchFetchCardData', () => {
      const origFetch = root.fetchCardData;
      if (typeof origFetch !== 'function' || origFetch.__cgTurbo) return;
      const f = function () {
        if (pageBumpDelta) {
          root.page = Math.max(0, (root.page | 0) - pageBumpDelta);
          pageBumpDelta = 0;
        }
        return origFetch.apply(this, arguments);
      };
      f.__cgTurbo = true;
      try { root.$.ctx.fetchCardData = f; } catch (_) { /* ignore */ }
      try { root.fetchCardData = f; } catch (_) { /* ignore */ }
    });

    // Aplica um lote inteiro de eventos de uma vez:
    //  - sem o "this.webSocketInput = e" do original, que trocava uma prop de TODOS
    //    os cards e disparava centenas de watchers deep + re-renders por evento;
    //  - reordena a lista uma vez por lote;
    //  - atualiza o status online só dos cards afetados.
    function applyBatch(items) {
      if (!canReplicate) {
        for (let i = 0; i < items.length; i++) {
          try { bound(items[i]); } catch (_) { stats.badEvents++; }
        }
        capList();
        return;
      }
      const cards = root.cards;
      const rawArr = cards.__v_raw || cards;
      const index = new Map();
      for (let i = 0; i < rawArr.length; i++) index.set(rawArr[i].id, i);
      const removed = new Set();
      const touched = [];
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        try {
          if (shouldRemove(e)) { if (index.has(e.id)) removed.add(e.id); continue; }
          const n = index.get(e.id);
          if (n !== undefined) { cards[n] = e; touched.push(e); }
          else { index.set(e.id, rawArr.length); cards.push(e); }
        } catch (_) { stats.badEvents++; } // evento malformado: descarta só ele, como o site faria
      }
      if (removed.size) root.cards = root.cards.filter((c) => !removed.has(c.id));
      root.orderRefresh();
      safe('capList', capList);
      if (wsHandler && touched.length) {
        let missing = false;
        for (let i = 0; i < touched.length; i++) if (!findInst(touched[i].id)) { missing = true; break; }
        if (missing) rebuildInstCache();
        for (let i = 0; i < touched.length; i++) {
          const inst = findInst(touched[i].id);
          if (inst) { try { wsHandler.call(inst.proxy, touched[i]); } catch (_) { /* ignore */ } }
        }
      }
    }

    // ---- fila + agendador adaptativo (em uso / inativo / aba oculta)
    const queue = new Map();
    let timer = 0, timerDelay = 0, timerAt = 0;
    let lastInput = Date.now();

    function mode() {
      if (CFG.hiddenBatchMs > 0 && document.hidden) return 'hidden';
      if (CFG.idleBatchMs > 0 && Date.now() - lastInput > CFG.idleAfterMs) return 'idle';
      return 'active';
    }
    function delayFor(m) {
      return m === 'hidden' ? CFG.hiddenBatchMs : m === 'idle' ? CFG.idleBatchMs : CFG.batchMs;
    }
    function flush() {
      timer = 0;
      if (!queue.size) return;
      const m = mode();
      const items = Array.from(queue.values());
      queue.clear();
      stats.flushes++;
      stats.flushByMode[m] = (stats.flushByMode[m] || 0) + 1;
      const t0 = performance.now();
      try { applyBatch(items); stats.applied += items.length; }
      catch (err) {
        // erro estrutural (ordenação/lista): cai para o caminho original, item a item
        if (stats.errors.length < 50) stats.errors.push('lote: ' + (err && err.message));
        console.warn(TAG, 'falha ao aplicar lote; usando updateCard original', err);
        for (let i = 0; i < items.length; i++) { try { bound(items[i]); } catch (_) { /* ignore */ } }
      }
      stats.flushMs += performance.now() - t0;
    }
    function schedule() {
      const m = mode();
      stats.sched = m;
      const d = delayFor(m);
      if (timer) {
        if (d >= timerDelay) return;
        clearTimeout(timer);
        timer = setTimeout(flush, Math.max(0, timerAt + d - Date.now()));
        timerDelay = d;
        return;
      }
      timerAt = Date.now(); timerDelay = d;
      timer = setTimeout(flush, d);
    }
    function flushNow() {
      if (timer) { clearTimeout(timer); timer = 0; }
      flush();
    }

    const wrapper = function (e) {
      stats.events++;
      if (!e || e.id == null) return bound(e);
      if (!queue.has(e.id) && queue.size >= CFG.maxQueue) { queue.delete(queue.keys().next().value); stats.dropped++; }
      queue.set(e.id, e);
      schedule();
    };
    wrapper.__cgTurbo = true;

    // Ao voltar para a aba: se o Pusher ficou "disconnected" e o próprio site não
    // o recuperou em 10 s, reconecta. Nunca mexe em "unavailable"/"failed", que o
    // pusher-js e o site tratam sozinhos (inclusive a espera de 30 s do erro 4004).
    let pusherCheck = 0;
    function checkPusher() {
      clearTimeout(pusherCheck);
      pusherCheck = setTimeout(() => {
        try {
          const p = window.pusher || (window.Pusher && window.Pusher.instances && window.Pusher.instances[0]);
          if (!p || !p.connection || p.connection.state !== 'disconnected') return;
          stats.reconnects++;
          log('Pusher continuava desconectado 10 s depois de voltar para a aba; reconectando');
          p.connect();
        } catch (_) { /* ignore */ }
      }, 10000);
    }

    let hiddenSince = document.hidden ? Date.now() : 0;
    document.addEventListener('visibilitychange', () => {
      safe('visibilitychange', () => {
        if (document.hidden) { hiddenSince = Date.now(); stats.sched = 'hidden'; return; }
        const away = hiddenSince ? Date.now() - hiddenSince : 0;
        hiddenSince = 0; lastInput = Date.now(); stats.sched = 'active';
        if (queue.size) { log('aba visível após ' + Math.round(away / 1000) + ' s; aplicando ' + queue.size + ' atualizações'); flushNow(); }
        checkPusher();
      });
    });

    if (CFG.idleBatchMs > 0) {
      const onInput = () => {
        const wasIdle = Date.now() - lastInput > CFG.idleAfterMs;
        lastInput = Date.now();
        if (wasIdle && timer) schedule();
      };
      ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
        window.addEventListener(ev, onInput, { passive: true, capture: true }));
    }

    try { root.$.ctx.updateCard = wrapper; } catch (_) { /* ignore */ }
    try { root.updateCard = wrapper; } catch (_) { /* ignore */ }
    if (root.updateCard !== wrapper) { log('não consegui substituir updateCard'); stats.mode = 'failed'; return; }

    api.flushNow = flushNow;
    api.queueSize = () => queue.size;
    log('lista otimizada (' + stats.mode + '; lote ' + CFG.batchMs + ' ms em uso, ' + CFG.idleBatchMs + ' ms inativo, ' +
      CFG.hiddenBatchMs + ' ms oculta; teto ' + (CFG.maxCards || 'desligado') + ' cards)');
  }

  let rootPatched = false;
  function onRoot(root) {
    if (rootPatched || !root || !root.$ || !root.$options) return;
    rootPatched = true;
    safe('patchDateCalc', () => patchDateCalc(root));
    safe('patchIndexChurn', () => patchIndexChurn(root));
    safe('patchUpdateCard', () => patchUpdateCard(root));
  }

  // Captura o momento exato em que o app faz "window.testeVueJS = this" (mounted)
  safe('hookRoot', () => {
    const existing = window.testeVueJS;
    if (existing) { onRoot(existing); return; }
    let value;
    try {
      Object.defineProperty(window, 'testeVueJS', {
        configurable: true,
        enumerable: true,
        get() { return value; },
        set(v) { value = v; safe('onRoot', () => onRoot(v)); },
      });
    } catch (_) {
      const t0 = Date.now();
      (function poll() {
        if (window.testeVueJS) return onRoot(window.testeVueJS);
        if (Date.now() - t0 < 120000) setTimeout(poll, 250);
      })();
    }
  });

  if (CFG.log) {
    setInterval(() => {
      if (stats.events) {
        log('eventos=' + stats.events + ' lotes=' + stats.flushes + ' média=' + (stats.flushes ? (stats.flushMs / stats.flushes).toFixed(1) : 0) +
          'ms aparados=' + stats.trimmed + ' modo=' + stats.sched + ' bloqueados=' + stats.blocked.length);
      }
    }, 300000);
  }

  log('v' + VERSION + ' ativo em ' + location.pathname + (stats.prodMode === 'on' ? ' (Vue em modo produção)' : ''));
})();
