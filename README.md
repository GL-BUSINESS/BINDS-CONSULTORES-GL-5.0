# BINDS-CONSULTORES-GL-5.0

Userscripts (Tampermonkey) do ChatGuru da equipe.

## Como funciona desde 25/09/2026

Cada `*.user.js` daqui é só um **carregador**, instalado uma vez em cada PC e que não muda mais.
Toda vez que o ChatGuru abre, ele baixa o código de verdade em `codigo/<NOME>.js` e **só roda se
a assinatura (`codigo/<NOME>.js.sig`) bater** com a chave pública que ele carrega.

- Mudou o código e assinou: vale no próximo F5 de todo mundo (o GitHub guarda cópia por até 5 min).
- **Editar no GitHub sem assinar não muda nada nos PCs**: o carregador recusa e segue rodando a
  última versão assinada que guardou no navegador.
- GitHub fora do ar: roda a última versão assinada guardada.
- PC que nunca rodou e não consegue código assinado: mostra um aviso vermelho no canto da tela.

## Para mudar um script

1. Edite `codigo/<NOME>.js` (não o `.user.js`).
2. No s2, na pasta do repositório: `python3 assinar.py` — confere a sintaxe (`node --check`) e
   assina o que mudou com a chave privada, que fica **só no s2** (`~/.gl-userscripts-assinatura.pem`).
3. `git add codigo && git commit && git push`.

`python3 assinar.py --conferir` só confere, sem escrever nada.

## Script novo

Crie `codigo/<NOME>.js`, assine, e copie um dos carregadores como `<NOME>.user.js` trocando o
`@name`, o `@version`, as URLs e a constante `NOME`. O carregador só precisa ser instalado uma vez.
