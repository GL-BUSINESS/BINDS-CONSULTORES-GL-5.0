// ==UserScript==
// @name         ChatGuru – mensagem pronta
// @namespace    glcapital
// @version      4.0
// @match        https://s12.chatguru.app/*
// @run-at       document-idle
// @grant        none
// @description  Carregador: baixa codigo/CHATGURU-MENSAGEM-PRONTA.js do GitHub e só roda se estiver assinado
// @updateURL    https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// @downloadURL  https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// ==/UserScript==

// CARREGADOR — este arquivo não muda mais. O código de verdade é codigo/CHATGURU-MENSAGEM-PRONTA.js, baixado do
// GitHub toda vez que o ChatGuru abre, e SÓ RODA SE ESTIVER ASSINADO com a chave que fica no s2
// (~/.gl-userscripts-assinatura.pem): escrever no GitHub não basta. Mudou e assinou (assinar.py),
// vale no próximo F5 de todo mundo — o GitHub guarda cópia por até 5 min. Decisão do dono em
// 25/09/2026.
(function () {
  'use strict';

  const NOME = 'CHATGURU-MENSAGEM-PRONTA';
  const URL = `https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/codigo/${NOME}.js`;
  const CHAVE_PUBLICA = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5XNIVuf1tTqYWc8M4+BL1dr5McbNg7Z0UpNncF3L++XbNxmCLIb0aicGiTW4bHvs2TwhXr++DZMV5aMu+itz9Q==';
  // A última versão assinada que rodou: vale se o GitHub não responder
  const GUARDADO = `gl_codigo_${NOME}`;

  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // A assinatura cobre "<NOME>\n<código>": a de um script não serve para outro
  async function assinado(codigo, assinatura) {
    try {
      const chave = await crypto.subtle.importKey('spki', bytes(CHAVE_PUBLICA),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, chave,
        bytes(assinatura.trim()), new TextEncoder().encode(`${NOME}\n${codigo}`));
    } catch (e) {
      return false;
    }
  }

  async function baixar(url) {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      if (r.ok) return await r.text();
      console.warn(`[gl] ${NOME}: o GitHub respondeu HTTP ${r.status} para ${url}`);
    } catch (e) {
      console.warn(`[gl] ${NOME}: não baixei ${url}`, e);
    } finally {
      clearTimeout(prazo);
    }
    return null;
  }

  function ler() {
    try { return JSON.parse(localStorage.getItem(GUARDADO)) || null; } catch (e) { return null; }
  }
  function guardar(codigo, assinatura) {
    try { localStorage.setItem(GUARDADO, JSON.stringify({ codigo, assinatura })); } catch (e) { /* sem storage */ }
  }

  // eval indireto: roda no escopo global da página, como o script instalado rodava
  function rodar(codigo, origem) {
    (0, eval)(`${codigo}\n//# sourceURL=gl-${NOME}.js`);
    console.log(`[gl] ${NOME}: rodando o código ${origem}`);
  }

  function avisar(texto) {
    const aviso = document.createElement('div');
    aviso.textContent = texto;
    Object.assign(aviso.style, {
      position: 'fixed', left: '16px', bottom: '16px', zIndex: 2147483000, maxWidth: '380px',
      padding: '8px 12px', background: '#b91c1c', color: '#fff', font: '13px sans-serif',
      borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,.25)',
    });
    (document.body || document.documentElement).appendChild(aviso);
    setTimeout(() => aviso.remove(), 15000);
  }

  (async () => {
    const [codigo, assinatura] = await Promise.all([baixar(URL), baixar(`${URL}.sig`)]);
    if (codigo && assinatura) {
      if (await assinado(codigo, assinatura)) {
        try {
          rodar(codigo, 'do GitHub');
          guardar(codigo, assinatura);
          return;
        } catch (e) {
          console.error(`[gl] ${NOME}: o código do GitHub falhou`, e);
          // Erro de sintaxe não chega a rodar nada, então dá para cair na versão guardada. Erro no
          // meio da execução pode já ter ligado metade do script: rodar a velha em cima duplicaria.
          if (!(e instanceof SyntaxError)) {
            avisar(`${NOME}: o código novo deu erro ao rodar. Avise o TI.`);
            return;
          }
        }
      } else {
        // Editado sem assinar (ou a cópia de 5 min do GitHub pegou um sem o outro): fica o guardado
        console.warn(`[gl] ${NOME}: o código do GitHub não tem assinatura válida — não rodo`);
      }
    }
    const velho = ler();
    if (velho && velho.codigo !== codigo && await assinado(velho.codigo, velho.assinatura)) {
      try {
        rodar(velho.codigo, 'guardado neste navegador');
        return;
      } catch (e) {
        console.error(`[gl] ${NOME}: o código guardado também falhou`, e);
      }
    }
    avisar(`${NOME} não carregou (GitHub fora do ar ou código sem assinatura): os atalhos dele estão desligados. Avise o TI.`);
  })();
})();
