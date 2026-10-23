# BINDS-CONSULTORES-GL-5.0

Userscripts (Tampermonkey) do ChatGuru da equipe — e, desde 23/10/2026, um do **New Corban**
(`NEWCORBAN-COLETOR`: a aba ociosa do consultor completa cadastros do Cliente 360 com a
sessão que a própria página já usa; nasce desligado, sem token nenhum).

## Como funciona desde 25/09/2026

Cada `*.user.js` daqui é só um **carregador**, instalado uma vez em cada PC e que não muda mais.
Toda vez que o ChatGuru abre, ele baixa o código de verdade em `codigo/<NOME>.js` e roda.

- Mudou `codigo/<NOME>.js` na `main`: vale no próximo F5 de todo mundo (o GitHub guarda cópia
  por até 5 min). Não precisa mexer no `@version`.
- GitHub fora do ar, ou código novo com erro de sintaxe: roda a última versão que funcionou,
  guardada no navegador.
- PC que nunca rodou e não consegue baixar: mostra um aviso vermelho no canto da tela.

## ⚠ Quem escreve aqui roda código no ChatGuru de todos

Sem assinatura (decisão do dono em 25/09/2026, "desde que só essas 3 contas possam alterar"):
quem consegue escrever na `main` deste repositório roda código no ChatGuru de todos os
consultores, logado com a conta de cada um. Por isso:

- só os 3 **Owners** da GL-BUSINESS escrevem; o **Base role** da organização fica em **Read**;
- **deploy keys** seguem desligadas pela organização;
- dar escrita a mais alguém (pessoa, time, app ou chave) é dar isso junto;
- verificação em duas etapas ligada nas 3 contas.

Desde 23/10/2026 isso vale **também para o New Corban**: o `NEWCORBAN-COLETOR` roda na aba
do bureau, com a sessão de consulta do consultor. Escrever aqui passou a alcançar os dois
sites.

## Para mudar um script

Edite `codigo/<NOME>.js` (não o `.user.js`) e suba na `main`. Antes, confira a sintaxe com
`node --check codigo/<NOME>.js`.

## Script novo

Crie `codigo/<NOME>.js` e copie um dos carregadores como `<NOME>.user.js`, trocando o `@name`,
o `@version`, as URLs e a constante `NOME`. O carregador só precisa ser instalado uma vez.
