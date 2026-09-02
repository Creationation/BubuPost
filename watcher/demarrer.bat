@echo off
title BubuPost - surveillance de dossiers
cd /d "%~dp0"
node bubupost-watcher.cjs
echo.
echo La surveillance s'est arretee. Appuie sur une touche pour fermer.
pause >nul
