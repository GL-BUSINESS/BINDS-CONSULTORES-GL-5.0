// ==UserScript==
// @name         New Corban – coletor do Cliente 360
// @namespace    glcapital
// @version      1.0
// @match        https://*.newcorban.com.br/*
// @run-at       document-idle
// @grant        none
// @description  Carregador: baixa e roda codigo/NEWCORBAN-COLETOR.js do GitHub a cada abertura do New Corban
// @updateURL    https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/NEWCORBAN-COLETOR.user.js
// @downloadURL  https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/NEWCORBAN-COLETOR.user.js
// ==/UserScript==

// CARREGADOR — este arquivo não muda mais. O código de verdade é codigo/NEWCORBAN-COLETOR.js,
// baixado do GitHub toda vez que o New Corban abre: mudou lá, vale no próximo F5 de todo mundo
// (o GitHub guarda cópia por até 5 min). É o mesmo desenho dos 7 carregadores do ChatGuru.
//
// @match é TODO *.newcorban.com.br de propósito: o script só acorda onde encontra o login que a
// própria página usa no apiv2. Assim não depende de a gente saber hoje qual subdomínio a tela de
// consulta deles vai usar amanhã.
//
// NASCE DESLIGADO: sem o token que o TI entrega a cada consultor, ele não pede CPF nenhum. Ligar e
// desligar é no selo do canto da tela, pelo próprio consultor.
//
// SEM ASSINATURA, decisão do dono em 25/09/2026, "desde que só essas 3 contas possam alterar":
// quem escreve na main deste repositório roda código no New Corban de todos os consultores, com a
// sessão deles — e aqui essa sessão é a do bureau. Hoje escrevem só os 3 Owners da GL-BUSINESS
// (Base role Read, deploy keys desligadas pela organização). Dar escrita a mais alguém é dar isso
// junto.
(function () {
  'use strict';

  const NOME = 'NEWCORBAN-COLETOR';
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

  (async () => {
    const novo = await baixar();
    if (novo) {
      try {
        rodar(novo, 'do GitHub');
        guardar(novo);
        return;
      } catch (e) {
        console.error(`[gl] ${NOME}: o código do GitHub falhou`, e);
        // Erro de sintaxe não chega a rodar nada, então dá para cair na versão guardada.
        // Erro no meio da execução pode já ter ligado metade do script: rodar a velha em
        // cima duplicaria o laço.
        if (!(e instanceof SyntaxError)) return;
      }
    }
    const velho = ler();
    if (velho && velho !== novo) {
      try {
        rodar(velho, 'guardado neste navegador');
      } catch (e) {
        console.error(`[gl] ${NOME}: o código guardado também falhou`, e);
      }
    }
    // Sem aviso vermelho na tela, ao contrário dos carregadores do ChatGuru: lá o script
    // fora do ar tira um atalho que o consultor usa; aqui ele só deixa de enriquecer em
    // segundo plano — nada do trabalho dele muda, e um alerta só assustaria.
  })();
})();
