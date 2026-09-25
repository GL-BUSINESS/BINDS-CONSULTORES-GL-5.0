#!/usr/bin/env python3
"""Assina o código dos userscripts: codigo/<NOME>.js → codigo/<NOME>.js.sig.

Os .user.js deste repositório são só CARREGADORES: a cada abertura do ChatGuru eles baixam
codigo/<NOME>.js e a assinatura dele, e só rodam o código se a assinatura bater com a chave
pública que carregam. Editar no GitHub sem assinar não muda nada nos PCs — o carregador segue
rodando a última versão assinada que guardou.

A chave privada fica no s2, em ~/.gl-userscripts-assinatura.pem (600), e NUNCA entra aqui.

    python3 assinar.py            # assina o que mudou e diz o quê
    python3 assinar.py --conferir # só confere, não escreve nada (sai 1 se algo não bate)

Depois: git add codigo && git commit && git push. Vale no próximo F5 de todo mundo (o GitHub
guarda cópia por até 5 min).

O que se assina é `<NOME>\\n<bytes do arquivo>`: com o nome junto, a assinatura de um script não
serve para outro. Arquivo que não passa no `node --check` não é assinado — um erro de sintaxe
assinado derrubaria o script em todos os PCs.
"""
import base64
import os
import subprocess
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import (decode_dss_signature,
                                                             encode_dss_signature)

CHAVE = Path(os.path.expanduser("~/.gl-userscripts-assinatura.pem"))
CODIGO = Path(__file__).resolve().parent / "codigo"


def mensagem(arquivo: Path) -> bytes:
    return arquivo.stem.encode() + b"\n" + arquivo.read_bytes()


def para_bruto(der: bytes) -> bytes:
    """DER → r||s de 64 bytes, o formato que o crypto.subtle.verify do navegador espera."""
    r, s = decode_dss_signature(der)
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def confere(publica, arquivo: Path) -> bool:
    sig = arquivo.with_name(arquivo.name + ".sig")
    if not sig.exists():
        return False
    bruto = base64.b64decode(sig.read_text().strip())
    der = encode_dss_signature(int.from_bytes(bruto[:32], "big"), int.from_bytes(bruto[32:], "big"))
    try:
        publica.verify(der, mensagem(arquivo), ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def main() -> int:
    so_conferir = "--conferir" in sys.argv
    privada = serialization.load_pem_private_key(CHAVE.read_bytes(), password=None)
    publica = privada.public_key()
    falhou = False
    for arquivo in sorted(CODIGO.glob("*.js")):
        if arquivo.read_bytes().startswith(b"\xef\xbb\xbf"):
            print(f"✗ {arquivo.name}: começa com BOM — o navegador o descarta e a assinatura não bate")
            falhou = True
            continue
        if confere(publica, arquivo):
            print(f"= {arquivo.name}: assinatura em dia")
            continue
        if so_conferir:
            print(f"✗ {arquivo.name}: SEM assinatura válida — os PCs seguem na versão anterior")
            falhou = True
            continue
        checagem = subprocess.run(["node", "--check", str(arquivo)], capture_output=True, text=True)
        if checagem.returncode != 0:
            print(f"✗ {arquivo.name}: erro de sintaxe, NÃO assinei\n{checagem.stderr.strip()}")
            falhou = True
            continue
        der = privada.sign(mensagem(arquivo), ec.ECDSA(hashes.SHA256()))
        arquivo.with_name(arquivo.name + ".sig").write_text(base64.b64encode(para_bruto(der)).decode() + "\n")
        print(f"✓ {arquivo.name}: assinado")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(main())
