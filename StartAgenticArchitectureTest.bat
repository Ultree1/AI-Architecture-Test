@echo off
echo Starting AI Harness...
start "Orchestrator" cmd /k "node orchestrator.js"
start "Researcher" cmd /k "node researcher.js"
echo Both bots started. You can minimize these windows.