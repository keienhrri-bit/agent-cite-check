@echo off
rem Launcher for cmd and PowerShell when this folder is on PATH (the Claude Code plugin adds bin/ to PATH).
rem Without it, Windows finds agent-cite-check.js first and opens it with Windows Script Host instead of Node.
node "%~dp0agent-cite-check.js" %*
