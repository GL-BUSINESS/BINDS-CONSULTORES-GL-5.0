// ==UserScript==
// @name         ATALHOS PADRONIZADOS - CONSIGNADO CLT OPERACIONAL
// @version      2.1
// @match        https://s12.chatguru.app/*
// @grant        none
// @description  Carregador: baixa e roda codigo/BINDS-CLT-OPERACIONAL.js do GitHub a cada abertura do ChatGuru
// @updateURL    https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/BINDS-CLT-OPERACIONAL.user.js
// @downloadURL  https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/BINDS-CLT-OPERACIONAL.user.js
// ==/UserScript==

// CARREGADOR — este arquivo não muda mais. O código de verdade é codigo/BINDS-CLT-OPERACIONAL.js, baixado do
// GitHub toda vez que o ChatGuru abre: mudou lá, vale no próximo F5 de todo mundo (o GitHub guarda
// cópia por até 5 min).
//
// SEM ASSINATURA, decisão do dono em 25/09/2026, "desde que só essas 3 contas possam alterar":
// quem escreve na main deste repositório roda código no ChatGuru de todos os consultores, com a
// sessão deles. Hoje escrevem só os 3 Owners da GL-BUSINESS (Base role Read, deploy keys
// desligadas pela organização). Dar escrita a mais alguém é dar isso junto.
(function () {
  'use strict';

  const NOME = 'BINDS-CLT-OPERACIONAL';
  const URL = `https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/codigo/${NOME}.js`;
  // A última versão que rodou bem: vale se o GitHub não responder
  const GUARDADO = `gl_codigo_${NOME}`;

  function ler() {
    try { return (JSON.parse(localStorage.getItem(GUARDADO)) || {}).codigo || null; } catch (e) { return null; }
  }
  function guardar(codigo) {
    try { localStorage.setItem(GUARDADO, JSON.stringify({ codigo })); } catch (e) { /* sem storage */ }
  }

  async function baixar() {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetch(URL, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
      if (r.ok) return await r.text();
      console.warn(`[gl] ${NOME}: o GitHub respondeu HTTP ${r.status}`);
    } catch (e) {
      console.warn(`[gl] ${NOME}: não baixei o código do GitHub`, e);
    } finally {
      clearTimeout(prazo);
    }
    return null;
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
    const novo = await baixar();
    if (novo) {
      try {
        rodar(novo, 'do GitHub');
        guardar(novo);
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
    }
    const velho = ler();
    if (velho && velho !== novo) {
      try {
        rodar(velho, 'guardado neste navegador');
        return;
      } catch (e) {
        console.error(`[gl] ${NOME}: o código guardado também falhou`, e);
      }
    }
    avisar(`${NOME} não carregou (GitHub fora do ar ou código com erro): os atalhos dele estão desligados. Avise o TI.`);
  })();
})();
