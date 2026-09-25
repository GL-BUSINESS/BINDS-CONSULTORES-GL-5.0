// BINDS-FGTS — o código de verdade do userscript BINDS-FGTS.user.js, que agora é só o carregador.
// Editou aqui: rode `python3 assinar.py` no s2 e suba codigo/ na main. Sem assinatura, os
// PCs seguem na versão anterior. Roda no escopo da página do ChatGuru.

(function() {
    'use strict';

    // =========================================================================
    //
    //                           PROIBIDO ALTERAR POR CONTA PROPRIA!
    //
    // =========================================================================
    const CONFIGURACAO_ATALHOS = {
        'F1':  ['6a6d66fd26c72b9fbafd66ee'], // delegar clt
        'F2':  ['6a6cd569df27400876c417c9'], // fluxo fgts
        'F3':  ['6a6cd577df27400876c417fc'], // Envio manual consultores
        'F4':  ['6a3064a215997fc4040dfe15'], // Inicio Atendimento
        'F6':  ['69dce931939d5d56e962fed1'], // fechar atend
        'F7':  ['65f9b93c0962dc56032327ce'],  // sem saldo 21
        'F8':  ['660eed83b644ff84d9cfe4a9'],  // cont atend
        'F9':  ['67d2d40f754db923f517fb7f'],  // detalhado ns
        'F10': ['699721ee8320bfb90ed2464a'],  // aniversário
        'F11': ['69fcb8274c65297d14982a0a'], // depois de passar valor
        'F12': ['69205d691b9474ab13c568d3'],  // audio fgts negado
        "CTRL+'": ['6a18695f48bb99c330346eb8'],   // ainda não aut
    };
    // =========================================================================

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

    // Monta o nome da tecla no mesmo formato usado na configuracao acima.
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

    document.addEventListener('keydown', function(e) {
        const teclaPressionada = nomeDaTecla(e);

        if (CONFIGURACAO_ATALHOS.hasOwnProperty(teclaPressionada)) {

            const listaIds = CONFIGURACAO_ATALHOS[teclaPressionada];

            // Atalho ainda sem dialogo configurado: deixa a tecla passar normal.
            if (listaIds[0] === '') {
                return;
            }

            // Bloqueia o comando do Chrome imediatamente.
            // Isso impede o F6 de ir para a barra de endereco e o F1 de abrir ajuda.
            e.preventDefault();
            e.stopPropagation();

            for (var i = 0; i < listaIds.length; i++) {
                var selector = 'button[data-dialog-id="' + listaIds[i] + '"]';
                var clicouComSucesso = dispararClique(selector);

                if (clicouComSucesso) {
                    break;
                }
            }
        }
    }, true); // O "true" aqui faz o script ouvir a tecla antes de qualquer outra coisa na página
})();
