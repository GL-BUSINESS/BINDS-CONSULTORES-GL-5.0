// BINDS-CLT-OPERACIONAL — o código de verdade do userscript BINDS-CLT-OPERACIONAL.user.js, que agora é só o carregador.
// Editou aqui e subiu na main: vale no próximo F5 de todo mundo, sem mexer no @version.
// Roda no escopo da página do ChatGuru.

(function () {
    'use strict';

    // Os atalhos desta equipe NÃO moram aqui: são cadastrados no painel-dev (Tampermonkeys ›
    // Atalhos dos BINDS) e lidos sem login ao abrir o ChatGuru e a cada 2 minutos.
    const EQUIPE = 'clt_operacional';
    const LISTA_URL = 'https://gateway-s2.glcapital-ti.net/binds-atalhos';
    const RELER_MS = 2 * 60 * 1000;
    // A última lista boa: vale desde a abertura e segura os atalhos se o painel cair
    const CACHE_KEY = `gl_binds_${EQUIPE}`;
    // O diálogo de apresentação é de cada consultor, guardado neste navegador
    const APRESENTACAO_KEY = 'id_apresentacao_consultor';
    const DIALOGO_ID = /^[0-9a-f]{24}$/i;

    function lerLocal(chave) {
        try { return localStorage.getItem(chave); } catch (e) { return null; }
    }
    function gravarLocal(chave, valor) {
        try { localStorage.setItem(chave, valor); } catch (e) { /* sem storage: só não guarda */ }
    }

    let config = (() => {
        try { return JSON.parse(lerLocal(CACHE_KEY)) || null; } catch (e) { return null; }
    })() || { apresentacao: null, atalhos: [] };

    async function buscar() {
        const ctl = new AbortController();
        const prazo = setTimeout(() => ctl.abort(), 5000);
        try {
            const r = await fetch(LISTA_URL, { cache: 'no-store', credentials: 'omit', signal: ctl.signal });
            const j = await r.json();
            const minha = j && j.ok && j.equipes && j.equipes[EQUIPE];
            if (!minha || !Array.isArray(minha.atalhos)) throw new Error(`HTTP ${r.status}`);
            config = minha;
            gravarLocal(CACHE_KEY, JSON.stringify(config));
        } catch (e) {
            console.warn(`[binds ${EQUIPE}] não li os atalhos do painel`, e);
        } finally {
            clearTimeout(prazo);
        }
    }

    function dispararClique(seletor) {
        if (typeof $ !== 'undefined') {
            var jqBtn = $(seletor);
            if (jqBtn.length > 0) {
                jqBtn.click();
                return true;
            }
        }
        var jsBtn = document.querySelector(seletor);
        if (jsBtn) {
            jsBtn.click();
            return true;
        }
        return false;
    }

    // Monta o nome da tecla no mesmo formato do painel.
    // Ex.: "F7", "CTRL+'", "ALT+G"
    function nomeDaTecla(e) {
        var base = e.key.toUpperCase();

        // A apostrofe muda de lugar conforme o teclado (ABNT2 usa a tecla ao lado
        // do 1, US usa a do lado do ENTER) e as vezes chega como "Dead".
        // Tratamos apostrofe e aspas como a mesma tecla.
        if (base === "'" || base === '"' ||
            (base === 'DEAD' && (e.code === 'Quote' || e.code === 'Backquote'))) {
            base = "'";
        }

        var prefixo = '';
        if (e.ctrlKey || e.metaKey) prefixo += 'CTRL+';
        if (e.altKey) prefixo += 'ALT+';

        return prefixo + base;
    }

    function apresentacaoPessoal() {
        // Tenta pegar o ID que está salvo no computador do funcionário
        let idPessoal = lerLocal(APRESENTACAO_KEY);

        // Se não tiver nenhum ID salvo ainda...
        if (!idPessoal) {
            // Abre a caixinha perguntando o ID
            idPessoal = prompt("Configuração Inicial:\nCole aqui o seu ID de Diálogo de Apresentação Pessoal:");

            if (idPessoal) {
                idPessoal = idPessoal.trim();
                // Salva no navegador para nunca mais pedir
                gravarLocal(APRESENTACAO_KEY, idPessoal);
                alert("ID Salvo com sucesso! Aperte a tecla novamente para testar.");
            }
            return;
        }

        // Se já tem o ID salvo, faz o clique normal
        dispararClique('button[data-dialog-id="' + CSS.escape(idPessoal) + '"]');
    }

    document.addEventListener('keydown', function (e) {
        const tecla = nomeDaTecla(e);

        if (config.apresentacao && tecla === config.apresentacao) {
            e.preventDefault();
            e.stopPropagation();
            if (!e.repeat) apresentacaoPessoal();
            return;
        }

        const atalho = config.atalhos.find(a => a.tecla === tecla);
        if (!atalho) return;   // tecla sem atalho: passa normal

        // Bloqueia o comando do Chrome (o F6 iria para a barra de endereço, o F1 abriria a ajuda)
        e.preventDefault();
        e.stopPropagation();
        // Tecla segurada não dispara o diálogo de novo: cada disparo é mensagem ao lead
        if (e.repeat) return;

        for (const id of atalho.dialogos || []) {
            if (DIALOGO_ID.test(id) && dispararClique('button[data-dialog-id="' + id + '"]')) break;
        }
    }, true); // O "true" aqui faz o script ouvir a tecla antes de qualquer outra coisa na página

    buscar();
    setInterval(buscar, RELER_MS);
})();
