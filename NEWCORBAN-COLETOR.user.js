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
// ESTA CÓPIA (a do repositório) É MOLDE E NÃO FAZ NADA: `TOKEN` vazio e ele volta na primeira
// linha, sem nem baixar o código. O arquivo que se instala em cada PC é gerado por
// `ferramentas/chave.py <consultor>` do coletor-api, com o token daquela pessoa dentro e SEM
// @updateURL/@downloadURL — senão o Tampermonkey trocaria o arquivo do PC por este, sem token.
//
// POR QUE O TOKEN VEM POR AQUI e não no código: este repositório é PÚBLICO (é assim que o
// carregador baixa o código sem credencial). Token em arquivo público é token vazado, e com ele
// qualquer pessoa puxaria CPF da nossa fila e escreveria no Cliente 360. O código continua
// atualizando sozinho; só o segredo fica fora dele.
//
// NADA NA TELA (23/10/2026, decisão do dono): nem selo, nem aviso, nem log — para o consultor a
// aba é a mesma de sempre. Quem desliga alguém é o servidor (a linha dele em
// /opt/coletor-api/consultores). Diagnóstico de TI: `localStorage.gl_coletor_log = 'on'` + F5.
//
// SEM ASSINATURA, decisão do dono em 25/09/2026, "desde que só essas 3 contas possam alterar":
// quem escreve na main deste repositório roda código no New Corban de todos os consultores, com a
// sessão deles — e aqui essa sessão é a do bureau. Hoje escrevem só os 3 Owners da GL-BUSINESS
// (Base role Read, deploy keys desligadas pela organização). Dar escrita a mais alguém é dar isso
// junto.
(function () {
  'use strict';

  const NOME = 'NEWCORBAN-COLETOR';

  /* Preenchidos por ferramentas/chave.py na cópia de cada PC. Vazios aqui, de propósito. */
  const TOKEN = '';
  const CONSULTOR = '';

  if (!TOKEN) return;   // molde do repositório: nem baixa o código, nem mexe na página

  const LOG = (() => {
    try { return localStorage.getItem('gl_coletor_log') === 'on'; } catch (e) { return false; }
  })();
  const anotar = (...a) => { if (LOG) console.log(`[gl] ${NOME}:`, ...a); };
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
      anotar(`o GitHub respondeu HTTP ${r.status}`);
    } catch (e) {
      anotar('não baixei o código do GitHub', e);
    } finally {
      clearTimeout(prazo);
    }
    return null;
  }

  /* `new Function` em vez do eval indireto de antes: o token entra como PARÂMETRO e fica no
   * escopo da função. Em `window` (ou no localStorage) o JS da própria página poderia lê-lo.
   * Precisa do mesmo `unsafe-eval` que o eval já precisava — e que a página permite, senão
   * nenhum dos carregadores dos BINDS teria funcionado até hoje.
   *
   * O código guardado no navegador também recebe o token. Quem conseguisse escrever nesse
   * cache já estaria rodando JS nesta página com a sessão do bureau do consultor — que vale
   * muito mais do que o nosso token. */
  function rodar(codigo, origem) {
    // eslint-disable-next-line no-new-func
    new Function('TOKEN', 'CONSULTOR', `${codigo}\n//# sourceURL=gl-${NOME}.js`)(TOKEN, CONSULTOR);
    anotar(`rodando o código ${origem}`);
  }

  (async () => {
    const novo = await baixar();
    if (novo) {
      try {
        rodar(novo, 'do GitHub');
        guardar(novo);
        return;
      } catch (e) {
        anotar('o código do GitHub falhou', e);
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
        anotar('o código guardado também falhou', e);
      }
    }
    // Sem aviso vermelho na tela, ao contrário dos carregadores do ChatGuru: lá o script
    // fora do ar tira um atalho que o consultor usa; aqui ele só deixa de enriquecer em
    // segundo plano — nada do trabalho dele muda, e um alerta só assustaria.
  })();
})();
