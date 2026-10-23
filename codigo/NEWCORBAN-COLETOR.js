/* NEWCORBAN-COLETOR — a aba ociosa do consultor completa cadastros do Cliente 360.
 *
 * O QUE ELA FAZ, em uma frase: quando esta aba está parada, ela pede um CPF ao nosso
 * servidor, consulta a MESMA tela de consulta que o consultor já usa (o apiv2 do New
 * Corban, com a sessão desta página) e manda só a resposta de volta.
 *
 * O QUE ELA NÃO FAZ:
 *  - não manda o token do New Corban para lugar nenhum. O token é lido da própria página
 *    e usado aqui dentro; o que sobe para o s2 é a RESPOSTA da consulta;
 *  - não consulta enquanto o consultor está mexendo (precisa de OCIOSO_S sem interação);
 *  - não "martela": o intervalo é do SERVIDOR (ele responde 204 + Retry-After), e um
 *    `rate_limited` para o laço desta aba até a hora virar;
 *  - não mexe na tela: nada de clique, nada de preenchimento. Só fetch.
 *
 * NADA NA TELA (23/10/2026, decisão do dono): nenhum selo, nenhum painel, nenhum log. A
 * aba não muda em nada para o consultor. Quem mostra o que ela fez é a tela /coletor do
 * painel, por consultor. Diagnóstico de TI nesta máquina:
 * `localStorage.gl_coletor_log = 'on'` + F5 liga o log no console e expõe
 * `window.__glColetorEstado`.
 *
 * O TOKEN NÃO MORA AQUI. Ele é INJETADO pelo carregador instalado em cada PC. Este arquivo
 * é público — o repositório dos BINDS é público, é assim que o carregador o baixa sem
 * credencial nenhuma —, e segredo em arquivo público é segredo vazado: com o token qualquer
 * pessoa puxaria CPF da nossa fila (`/coletor/proximo` responde com um) e escreveria no
 * Cliente 360 (`/coletor/resultado`). Sem token injetado, o carregador nem chega a rodar
 * este código.
 *
 * DESLIGAR alguém é no SERVIDOR: apagar a linha dele em /opt/coletor-api/consultores (vale
 * na próxima chamada, sem restart) ou COLETOR_LIGADO=false para todos.
 *
 * Carregado por NEWCORBAN-COLETOR.user.js — editar ESTE arquivo vale no próximo F5.
 */
(function () {
  'use strict';

  const VERSION = '2.0';
  const BASE = 'https://gateway-s2.glcapital-ti.net';
  const APIV2 = 'https://apiv2.newcorban.com.br/api/v2/external-data/queries';
  const ALVO_APIV2 = 'apiv2.newcorban.com.br';

  /* O token do coletor e o id do consultor vêm INJETADOS pelo carregador deste PC (ver o
   * cabeçalho). Ficam no escopo desta função: não vão para `window` nem para o
   * localStorage, de onde o JS da própria página poderia lê-los. */
  const TOKEN_COLETOR = (typeof TOKEN === 'string' ? TOKEN : '').trim();
  const CONSULTOR_ID = ((typeof CONSULTOR === 'string' ? CONSULTOR : '').trim() || 'aba');

  /* Diagnóstico de TI nesta máquina. NÃO é liga/desliga: esse é do servidor. */
  const LOG = (() => {
    try { return localStorage.getItem('gl_coletor_log') === 'on'; } catch (e) { return false; }
  })();
  function anotar() {
    if (LOG) console.log.apply(console, ['[gl] coletor'].concat([].slice.call(arguments)));
  }

  const OCIOSO_S = 45;        // sem interação do consultor para a aba ser considerada ociosa
  const HEARTBEAT_S = 30;     // POST /coletor/online
  const TICK_MS = 5000;       // de quanto em quanto tempo o laço reavalia
  const ESPERA_PADRAO_S = 20; // quando o servidor não manda Retry-After
  const TIMEOUT_NOSSO_MS = 20000;
  const TIMEOUT_BUREAU_MS = 45000;

  /* 'omit' porque a autorização vai no cabeçalho, não em cookie: com 'include' o
   * navegador exige `Access-Control-Allow-Credentials` do apiv2 e, se eles responderem
   * `Allow-Origin: *`, a resposta seria BLOQUEADA. Se um dia a consulta começar a voltar
   * 401 aqui e funcionar na tela deles, troque para 'include' — vale no próximo F5. */
  const CREDENCIAIS_BUREAU = 'omit';

  if (window.__glColetor) return;            // o carregador roda a cada abertura
  window.__glColetor = true;

  const estado = {
    tokenApp: null,          // Authorization que a PRÓPRIA página usa no apiv2
    ondeAchou: '',
    ultimaInteracao: Date.now(),
    esperarAte: 0,
    emVoo: false,
    ultimoHeartbeat: 0,
    motivo: 'começando',
    contagem: { hit: 0, miss: 0, erro: 0, cota: 0 },
    parado: '',              // motivo definitivo (token nosso recusado, p.ex.)
  };

  /* ------------------------------------------------------------------ o token da página
   * Captura passiva: o app manda `Authorization` nas chamadas que ele mesmo faz ao apiv2.
   * Em vez de adivinhar o nome da chave no localStorage (que muda quando eles mexem no
   * front), a gente lê o cabeçalho que já está passando. Nada é guardado em disco.      */
  function anotarAutorizacao(url, valor) {
    if (!valor || !String(url).includes(ALVO_APIV2)) return;
    estado.tokenApp = valor;
    estado.ondeAchou = 'cabeçalho do próprio app';
  }

  function cabecalhoAutorizacao(headers) {
    if (!headers) return null;
    try {
      if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        return headers.get('authorization');
      }
      if (Array.isArray(headers)) {
        const par = headers.find((h) => String(h[0]).toLowerCase() === 'authorization');
        return par ? par[1] : null;
      }
      const chave = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
      return chave ? headers[chave] : null;
    } catch (e) { return null; }
  }

  const fetchOriginal = window.fetch;
  window.fetch = function (entrada, inicio) {
    try {
      const url = (entrada && entrada.url) || entrada;
      const headers = (inicio && inicio.headers) || (entrada && entrada.headers);
      anotarAutorizacao(url, cabecalhoAutorizacao(headers));
    } catch (e) { /* nunca estragar o fetch do app */ }
    return fetchOriginal.apply(this, arguments);
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  const porOriginal = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__glUrl = url;
    return abrirOriginal.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (nome, valor) {
    try {
      if (String(nome).toLowerCase() === 'authorization') anotarAutorizacao(this.__glUrl, valor);
    } catch (e) { /* idem */ }
    return porOriginal.apply(this, arguments);
  };

  /* Rede de segurança: se o consultor não fizer nenhuma consulta nesta aba, nenhum
   * cabeçalho passa. Aí vale procurar um JWT válido no armazenamento da página — sem
   * saber o nome da chave, só pela forma e pelo `exp`. */
  function jwtValido(valor) {
    if (typeof valor !== 'string' || valor.length < 40) return false;
    const partes = valor.replace(/^Bearer\s+/i, '').split('.');
    if (partes.length !== 3 || !partes[0].startsWith('eyJ')) return false;
    try {
      const corpo = JSON.parse(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')));
      return !corpo.exp || corpo.exp * 1000 > Date.now() + 60000;
    } catch (e) { return false; }
  }

  function procurarNoArmazenamento() {
    for (const loja of [window.localStorage, window.sessionStorage]) {
      let n = 0;
      try { n = loja.length; } catch (e) { continue; }
      for (let i = 0; i < n; i += 1) {
        let chave;
        let bruto;
        try { chave = loja.key(i); bruto = loja.getItem(chave); } catch (e) { continue; }
        if (!bruto) continue;
        if (jwtValido(bruto)) return { valor: bruto, chave };
        if (bruto[0] === '{' || bruto[0] === '[') {
          try {
            const achado = varrer(JSON.parse(bruto));
            if (achado) return { valor: achado, chave };
          } catch (e) { /* não é JSON */ }
        }
      }
    }
    return null;
  }

  function varrer(no, profundidade) {
    const nivel = profundidade || 0;
    if (nivel > 4 || !no) return null;
    if (typeof no === 'string') return jwtValido(no) ? no : null;
    if (typeof no !== 'object') return null;
    for (const valor of Object.values(no)) {
      const achado = varrer(valor, nivel + 1);
      if (achado) return achado;
    }
    return null;
  }

  function autorizacao() {
    if (estado.tokenApp) return estado.tokenApp;
    const achado = procurarNoArmazenamento();
    if (!achado) return null;
    estado.ondeAchou = 'armazenamento da página (' + achado.chave + ')';
    estado.tokenApp = /^Bearer\s/i.test(achado.valor) ? achado.valor : 'Bearer ' + achado.valor;
    return estado.tokenApp;
  }

  /* ------------------------------------------------------------------ ociosidade */
  ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart', 'focus'].forEach((evento) => {
    window.addEventListener(evento, () => { estado.ultimaInteracao = Date.now(); },
                            { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') estado.ultimaInteracao = Date.now();
  });

  function ocioso() {
    return Date.now() - estado.ultimaInteracao >= OCIOSO_S * 1000;
  }

  /* ------------------------------------------------------------------ o nosso servidor */
  function nossoToken() {
    return TOKEN_COLETOR;
  }

  async function nosso(caminho, opcoes) {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), TIMEOUT_NOSSO_MS);
    try {
      return await fetchOriginal(BASE + caminho, Object.assign({
        cache: 'no-store',
        credentials: 'omit',
        signal: ctl.signal,
        headers: { Authorization: 'Bearer ' + nossoToken() },
      }, opcoes || {}));
    } finally {
      clearTimeout(prazo);
    }
  }

  function esperar(resposta, padrao) {
    const cabecalho = resposta && resposta.headers && resposta.headers.get('Retry-After');
    const segundos = parseInt(cabecalho, 10);
    estado.esperarAte = Date.now() + (segundos > 0 ? segundos : (padrao || ESPERA_PADRAO_S)) * 1000;
  }

  /* ------------------------------------------------------------------ o bureau */
  async function consultar(cpf, auth) {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), TIMEOUT_BUREAU_MS);
    try {
      const r = await fetchOriginal(APIV2, {
        method: 'POST',
        cache: 'no-store',
        credentials: CREDENCIAIS_BUREAU,
        signal: ctl.signal,
        headers: { Authorization: auth, 'Content-Type': 'application/json',
                   Accept: 'application/json' },
        body: JSON.stringify({ kind: 'person', identifier_type: 'cpf', identifier: cpf }),
      });
      let corpo = null;
      try { corpo = await r.json(); } catch (e) { corpo = null; }
      return { http: r.status, corpo };
    } finally {
      clearTimeout(prazo);
    }
  }

  /* O rótulo é só telemetria: quem decide hit/miss é o servidor, sobre o corpo cru. */
  function rotular(http, corpo) {
    const erros = corpo && corpo.errors;
    const codigo = (erros && (erros.code || (Array.isArray(erros) && erros[0] && erros[0].code))) || '';
    if (codigo === 'external_data.rate_limited') return 'rate_limited';
    if (codigo === 'external_data.all_logins_busy') return 'ocupado';
    if (codigo === 'external_data.not_found' || codigo === 'external_data.invalid_cpf') return 'miss';
    if (http >= 200 && http < 300 && corpo && corpo.success === true) return 'hit';
    return 'erro';
  }

  /* ------------------------------------------------------------------ o laço */
  async function umaVolta() {
    if (estado.parado || estado.emVoo) return;
    if (!nossoToken()) { estado.motivo = 'sem o token do coletor'; return; }
    if (!ligado()) { estado.motivo = 'desligada'; return; }
    if (Date.now() < estado.esperarAte) {
      estado.motivo = 'esperando ' + Math.ceil((estado.esperarAte - Date.now()) / 1000) + 's';
      return;
    }
    if (!ocioso()) { estado.motivo = 'você está usando a aba'; return; }

    const auth = autorizacao();
    if (!auth) {
      estado.motivo = 'ainda não vi o login desta página (faça uma consulta)';
      return;
    }

    estado.emVoo = true;
    try {
      const r = await nosso('/coletor/proximo?consultor=' + encodeURIComponent(CONSULTOR_ID));
      if (r.status === 401) {
        estado.parado = 'o token do coletor não é válido. Avise o TI.';
        return;
      }
      if (r.status === 204) { esperar(r); estado.motivo = 'sem CPF na fila'; return; }
      if (!r.ok) { esperar(r, 60); estado.motivo = 'servidor fora (' + r.status + ')'; return; }

      const tarefa = await r.json();
      if (!tarefa || !tarefa.job_id || !tarefa.cpf) { esperar(r, 60); return; }
      estado.motivo = 'consultando';

      let saida;
      try {
        saida = await consultar(tarefa.cpf, auth);
      } catch (e) {
        saida = { http: 0, corpo: null };
      }
      const status = rotular(saida.http, saida.corpo);
      const BALDE = { hit: 'hit', miss: 'miss', rate_limited: 'cota', ocupado: 'erro', erro: 'erro' };
      estado.contagem[BALDE[status] || 'erro'] += 1;

      const devolucao = await nosso('/coletor/resultado', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + nossoToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: tarefa.job_id, cpf: tarefa.cpf, status,
                               http: saida.http, pessoa: saida.corpo }),
      });
      if (devolucao.status === 401) {
        estado.parado = 'o token do coletor não é válido. Avise o TI.';
        return;
      }
      let resposta = null;
      try { resposta = await devolucao.json(); } catch (e) { /* o desfecho é opcional */ }

      /* Cota da conta DELE: para o laço desta aba. O servidor já pausou do lado de lá;
       * aqui a espera evita até a próxima batida à porta. */
      if (status === 'rate_limited' || (resposta && resposta.desfecho === 'cota')) {
        const pausa = (resposta && resposta.pausado_s) || 1800;
        estado.esperarAte = Date.now() + pausa * 1000;
        estado.motivo = 'cota da sua conta esgotada: pausado';
        return;
      }
      if (status === 'ocupado') {
        estado.esperarAte = Date.now() + 60000;
        estado.motivo = 'o New Corban pediu calma';
        return;
      }
      if (status === 'erro') {
        estado.esperarAte = Date.now() + 60000;
        estado.motivo = 'a consulta falhou (' + saida.http + ')';
        return;
      }
      estado.motivo = status === 'hit' ? 'completou um cadastro' : 'CPF sem dado no bureau';
      estado.esperarAte = Date.now() + ESPERA_PADRAO_S * 1000;
    } catch (e) {
      estado.motivo = 'sem rede';
      estado.esperarAte = Date.now() + 60000;
    } finally {
      estado.emVoo = false;
      anotar(estado.motivo);
    }
  }

  async function bater() {
    if (!nossoToken() || !ligado() || estado.parado) return;
    if (Date.now() - estado.ultimoHeartbeat < HEARTBEAT_S * 1000) return;
    estado.ultimoHeartbeat = Date.now();
    try { await nosso('/coletor/online', { method: 'POST' }); } catch (e) { /* silêncio */ }
  }

  /* Sem selo não existe liga/desliga local: ter o token DESTE PC é estar ligada. Quem
   * desliga é o servidor — a linha do consultor apagada (401 na chamada seguinte, e o laço
   * para de vez) ou COLETOR_LIGADO=false (503 + Retry-After, e ela só volta a bater). */
  function ligado() {
    return Boolean(TOKEN_COLETOR);
  }

  /* O estado fica alcançável só com a chave de diagnóstico ligada: em PC de consultor não
   * há nada em `window` além da trava de carga dupla. */
  if (LOG) window.__glColetorEstado = estado;

  setInterval(() => { bater(); umaVolta(); }, TICK_MS);
  anotar(VERSION, 'rodando como', CONSULTOR_ID);
})();
