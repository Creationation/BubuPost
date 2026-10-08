# -*- coding: utf-8 -*-
r"""BubuPost : application de bureau + watcher en arriere-plan.

Meme comportement qu'EdgeSyncFX Studio :
- une vraie fenetre "BubuPost" (WebView2, pas de navigateur) qui affiche
  l'application en ligne ; la connexion est gardee d'un lancement a l'autre ;
- la croix MASQUE seulement la fenetre : le watcher continue ;
- icone pres de l'horloge (icones cachees) : Ouvrir BubuPost, Journal du
  watcher, Dossier des videos, Redemarrer le watcher, Quitter BubuPost ;
- on ne quitte vraiment que par l'icone (ce qui arrete aussi le watcher).

Watcher : watcher\bubupost-watcher.cjs tourne sans fenetre et repart 30 s
apres s'il s'arrete. Une seule instance (port local 47392) : relancer le
raccourci du Bureau rouvre la fenetre existante.

Options : --tray (demarrage avec Windows, fenetre masquee),
          --sans-watcher (tests : aucune video envoyee).
"""
import ctypes
import os
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime

import pystray
import webview
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # C:\BubuPost
WATCHER_DIR = os.path.join(ROOT, "watcher")
WATCHER = os.path.join(WATCHER_DIR, "bubupost-watcher.cjs")
LOGS = os.path.join(WATCHER_DIR, "logs")
ICON = os.path.join(ROOT, "desktop", "BubuPost.ico")
SITE = "https://bubu-post.vercel.app"
VIDEOS = r"C:\TradeReels\ready_to_post"
DONNEES_FENETRE = os.path.join(os.environ.get("LOCALAPPDATA", ROOT), "BubuPost", "fenetre")
PORT = 47392
NOWINDOW = 0x08000000
RELANCE_S = 30


def node_exe():
    for d in os.environ.get("PATH", "").split(os.pathsep):
        p = os.path.join(d, "node.exe")
        if os.path.isfile(p):
            return p
    p = r"C:\Program Files\nodejs\node.exe"
    return p if os.path.isfile(p) else "node"


def tray_log(msg):
    os.makedirs(LOGS, exist_ok=True)
    with open(os.path.join(LOGS, "icone.log"), "a", encoding="utf-8") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}\n")


def autres_watchers():
    """PID des watchers lances hors de cette appli (ancien demarrage auto)."""
    try:
        import psutil
    except ImportError:
        return []
    out = []
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            if "bubupost-watcher.cjs" in " ".join(p.info["cmdline"] or []):
                out.append(p.info["pid"])
        except Exception:
            pass
    return out


class App:
    def __init__(self, avec_watcher, masquee):
        self.avec_watcher = avec_watcher
        self.proc = None
        self.arret = threading.Event()
        self.quitter_demande = False
        self.astuce_montree = False
        self.window = webview.create_window(
            "BubuPost", SITE, width=1320, height=880, min_size=(900, 600), hidden=masquee)
        self.window.events.closing += self._sur_fermeture
        self.window.events.shown += self._sur_affichage
        self.icon = pystray.Icon(
            "BubuPost", Image.open(ICON), "BubuPost",
            pystray.Menu(
                pystray.MenuItem("Ouvrir BubuPost", lambda *_: self.montrer(), default=True),
                pystray.MenuItem("Journal du watcher", lambda *_: self.ouvrir_journal()),
                pystray.MenuItem("Dossier des videos", lambda *_: self.ouvrir(VIDEOS)),
                pystray.MenuItem("Redemarrer le watcher", lambda *_: self.redemarrer(),
                                 enabled=lambda *_: self.avec_watcher),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Quitter BubuPost (arrete le watcher)", lambda *_: self.quitter())))

    # ----------------------------------------------------------- fenetre
    def _sur_affichage(self):
        # L'icone de la fenetre et de la barre des taches : celle de BubuPost,
        # pas celle de Python.
        try:
            import clr  # noqa: F401  (pythonnet, fourni avec pywebview)
            from System.Drawing import Icon
            self.window.native.Icon = Icon(ICON)
        except Exception:
            pass

    def _sur_fermeture(self):
        if self.quitter_demande:
            return True
        # Masquer DEPUIS UN AUTRE FIL : cet evenement tourne sur le fil de la
        # fenetre, et hide() attend ce meme fil. L'appeler ici directement
        # figeait toute l'appli (constate le 08/10/2026).
        threading.Thread(target=self.window.hide, daemon=True).start()
        if not self.astuce_montree:
            self.astuce_montree = True
            try:
                self.icon.notify("BubuPost reste actif en arriere-plan (le watcher continue). "
                                 "Pour le quitter : clic droit sur son icone, pres de l'horloge.",
                                 "BubuPost")
            except Exception:
                pass
        return False            # annule la fermeture : la fenetre est seulement masquee

    def montrer(self):
        for etape in (self.window.show, self.window.restore):
            try:
                etape()
                tray_log(f"fenetre : {etape.__name__} ok")
            except Exception as e:
                tray_log(f"fenetre : {etape.__name__} impossible ({e!r})")

    # ----------------------------------------------------------- watcher
    def boucle_watcher(self):
        for pid in autres_watchers():          # jamais deux watchers a la fois
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, creationflags=NOWINDOW)
            tray_log(f"ancien watcher {pid} arrete (doublon)")
        while not self.arret.is_set():
            tray_log("watcher demarre")
            self.proc = subprocess.Popen([node_exe(), WATCHER], cwd=WATCHER_DIR,
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                         creationflags=NOWINDOW)
            code = self.proc.wait()
            if self.arret.is_set():
                break
            tray_log(f"watcher arrete (code {code}), relance dans {RELANCE_S} s")
            self.arret.wait(RELANCE_S)

    def stop_watcher(self):
        if self.proc and self.proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"],
                           capture_output=True, creationflags=NOWINDOW)

    def redemarrer(self):
        tray_log("redemarrage demande")
        self.stop_watcher()            # la boucle le relance au bout de RELANCE_S

    # ----------------------------------------------------------- etat
    def boucle_etat(self):
        while not self.arret.is_set():
            self.icon.title = self.texte_etat()
            self.arret.wait(20)

    def texte_etat(self):
        if not self.avec_watcher:
            return "BubuPost (watcher non lance)"
        if not (self.proc and self.proc.poll() is None):
            return "BubuPost : watcher en redemarrage"
        dernier = self.dernier_journal()
        if not dernier:
            return "BubuPost : watcher actif"
        age = int((time.time() - os.path.getmtime(dernier)) / 60)
        try:
            with open(dernier, encoding="utf-8", errors="replace") as f:
                ligne = f.readlines()[-1]
        except Exception:
            ligne = ""
        txt = f"BubuPost : watcher actif, journal il y a {age} min"
        return (txt + " (souci, voir le journal)")[:120] if " !! " in ligne else txt[:120]

    def dernier_journal(self):
        try:
            fichiers = [os.path.join(LOGS, f) for f in os.listdir(LOGS)
                        if f.endswith(".log") and f != "icone.log"]
            return max(fichiers, key=os.path.getmtime) if fichiers else None
        except OSError:
            return None

    # ----------------------------------------------------------- menu
    def ouvrir(self, chemin):
        if os.path.exists(chemin):
            os.startfile(chemin)

    def ouvrir_journal(self):
        self.ouvrir(self.dernier_journal() or LOGS)

    def quitter(self):
        tray_log("BubuPost quitte depuis l'icone")
        self.quitter_demande = True
        self.arret.set()
        self.stop_watcher()
        try:
            self.icon.stop()
        except Exception:
            pass
        try:
            self.window.destroy()
        except Exception:
            pass

    # ----------------------------------------------------------- lancement
    def lancer(self):
        if self.avec_watcher:
            threading.Thread(target=self.boucle_watcher, daemon=True).start()
        threading.Thread(target=self.boucle_etat, daemon=True).start()
        self.icon.run_detached()
        os.makedirs(DONNEES_FENETRE, exist_ok=True)
        # La boucle de la fenetre occupe le fil principal jusqu'a "Quitter".
        webview.start(private_mode=False, storage_path=DONNEES_FENETRE)
        self.quitter_demande = True
        self.arret.set()
        self.stop_watcher()
        try:
            self.icon.stop()
        except Exception:
            pass


def deja_lance():
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=1) as s:
            s.sendall(b"show")
        return True
    except OSError:
        return False


def ecouter(srv, app):
    while True:
        try:
            conn, _ = srv.accept()
            with conn:
                if conn.recv(16).startswith(b"show"):
                    tray_log("demande d'affichage recue (2e lancement)")
                    app.montrer()
        except OSError:
            return


if __name__ == "__main__":
    if deja_lance():
        sys.exit(0)
    try:   # BubuPost a son propre groupe dans la barre des taches (pas "Python")
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Creationation.BubuPost")
    except Exception:
        pass
    app = App("--sans-watcher" not in sys.argv, masquee="--tray" in sys.argv)
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        srv.bind(("127.0.0.1", PORT))
        srv.listen(5)
        threading.Thread(target=ecouter, args=(srv, app), daemon=True).start()
    except OSError:
        pass
    app.lancer()
