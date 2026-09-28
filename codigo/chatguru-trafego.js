// chatguru-trafego — o código de verdade do userscript chatguru-trafego.user.js, que agora é só o carregador.
// Editou aqui e subiu na main: vale no próximo F5 de todo mundo, sem mexer no @version.
// Roda no escopo da página do ChatGuru.
//
// Lê o campo personalizado "trafego" (timestamp) do chat aberto e mostra o selo TRAFEGO à esquerda
// do botão de status quando o timestamp tem menos de 7 dias.

(() => {
  'use strict';

  const CF_ID = '6aba76f93a304d4b7204c70b'; // id do campo personalizado "trafego"

  // Lê do painel de campos personalizados do chat aberto
  function lerDoDom() {
    const inp = document.querySelector(`#chat_custom_fields input[data-cf-id="${CF_ID}"]`);
    if (!inp || !inp.value.trim()) return null;
    return { chatId: inp.dataset.chatId, raw: inp.value.trim(), date: new Date(inp.value.trim()) };
  }

  // Lê de qualquer chat pelo endpoint (sem precisar abrir o chat)
  async function lerDoServidor(chatId) {
    const r = await fetch(`/chat/custom_fields/${chatId}/view`, {
      method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const raw = doc.querySelector(`input[data-cf-id="${CF_ID}"]`)?.getAttribute('value')?.trim();
    return raw ? { chatId, raw, date: new Date(raw) } : null;
  }

  function decorrido(d) {
    const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
    const dd = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return dd ? `${dd}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
  }

  const JANELA_MS = 7 * 24 * 3600 * 1000; // só mostra se o timestamp tiver menos de 7 dias

  const css = document.createElement('style');
  css.textContent = '@keyframes cgTrafegoPisca{0%,100%{opacity:1}50%{opacity:.35}}' +
    '#cg-trafego{align-items:center;padding:3px 8px;border-radius:4px;background:#28a745;color:#fff;' +
    'font-size:12px;font-weight:bold;line-height:1.3;white-space:nowrap;cursor:default;' +
    'animation:cgTrafegoPisca 1s ease-in-out infinite}' +
    '#cg-trafego:hover{animation-play-state:paused}';
  document.head.appendChild(css);

  // Retângulo à esquerda do botão de status (ABERTO / EM ATENDIMENTO / ...)
  const badge = document.createElement('span');
  badge.id = 'cg-trafego';
  badge.className = 'ml-2';
  badge.textContent = 'TRAFEGO';
  badge.style.display = 'none';

  function atualizar() {
    // o cabeçalho é recriado ao trocar de chat: recoloca o badge antes do status
    const grupo = document.getElementById('current_status')?.closest('.btn-group');
    if (!grupo) return;
    if (badge.nextElementSibling !== grupo) grupo.before(badge);

    const t = lerDoDom();
    const idade = t ? Date.now() - t.date : NaN;
    const visivel = t && !isNaN(idade) && t.chatId === location.hash.slice(1) && idade <= JANELA_MS && idade >= -60000;
    // só mexe no DOM quando algo muda
    const display = visivel ? 'inline-flex' : 'none';
    if (badge.style.display !== display) badge.style.display = display;
    if (!visivel) return;
    const title = `${t.date.toLocaleString('pt-BR')} · há ${decorrido(t.date)}`;
    if (badge.title !== title) badge.title = title;
  }

  setInterval(atualizar, 1000);

  // Acesso pelo console: __trafego.atual() / await __trafego.buscar('<chatId>')
  window.__trafego = { atual: lerDoDom, buscar: lerDoServidor };
})();
