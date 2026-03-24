@echo off
echo Starting AI Harness...
start "Search Service" cmd /k "python search_service.py"
timeout /t 3 /nobreak > nul
start "Orchestrator" cmd /k "node orchestrator.js"
start "Researcher" cmd /k "node researcher.js"
echo All services started.
