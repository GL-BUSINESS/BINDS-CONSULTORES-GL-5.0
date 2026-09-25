// ==UserScript==
// @name         ChatGuru – mensagem pronta
// @namespace    glcapital
// @version      2.1
// @description  Atalhos de teclado que enviam mensagens pré-definidas pelo POST /messages/
// @match        https://s12.chatguru.app/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// @downloadURL  https://raw.githubusercontent.com/GL-BUSINESS/BINDS-CONSULTORES-GL-5.0/main/CHATGURU-MENSAGEM-PRONTA.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Um atalho por mensagem. \n vira quebra de linha.
  // Tecla no formato 'ALT+1', 'CTRL+ALT+M', 'F10'. Os BINDS já usam F1–F12 e CTRL+'.
  const MENSAGENS = [
    { tecla: 'ALT+1', texto: 'Olá! Esta é uma mensagem pré-definida.' },
    // { tecla: 'ALT+2', texto: 'Outra mensagem\ncom duas linhas.' },
  ];

  // Pede confirmação antes de enviar (a mensagem sai de verdade no WhatsApp)
  const CONFIRMAR = true;

  const ATALHOS = new Map(MENSAGENS.map(m => [m.tecla.toUpperCase().replace(/\s/g, ''), m.texto]));

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

  // Segura 2 s depois do envio para a tecla apertada duas vezes não mandar duas mensagens
  let ocupado = false;

  async function enviar(texto) {
    if (ocupado) return;
    const chatId = chatAberto();
    if (!chatId) return alert('Abra um chat antes de enviar.');
    if (CONFIRMAR && !confirm(`Enviar para o chat aberto?\n\n${texto}`)) return;

    ocupado = true;
    try {
      const r = await fetch('/messages/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams({
          chat_id: chatId,
          message: texto,
          reply_msg_id: '',
          send_datetime: '',
        }),
      });
      const resposta = await r.text();
      console.log('[tm] POST /messages/', r.status, r.url, resposta);

      // Sem botão, o envio certo só aparece no próprio chat; erro vira alerta.
      // Sessão vencida: o ChatGuru redireciona para /login e devolve 200 com a página
      if (r.redirected || r.url.includes('/login')) alert('Mensagem NÃO enviada: sessão expirada. Entre de novo no ChatGuru.');
      else if (!r.ok) alert(`Mensagem NÃO enviada: erro ${r.status}.`);
    } catch (e) {
      console.error('[tm] POST /messages/ falhou', e);
      alert('Mensagem NÃO enviada: erro de rede.');
    } finally {
      setTimeout(() => { ocupado = false; }, 2000);
    }
  }

  document.addEventListener('keydown', (e) => {
    const texto = ATALHOS.get(nomeDaTecla(e));
    if (texto === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) enviar(texto);
  }, true); // true: ouve a tecla antes do ChatGuru, como nos BINDS
})();
