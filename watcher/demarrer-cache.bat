@echo off
rem Tourne en arriere-plan, relance le watcher s il s arrete.
cd /d "%~dp0"
:boucle
node bubupost-watcher.cjs
timeout /t 30 /nobreak >nul
goto boucle
