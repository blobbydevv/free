@echo off
cd /d "%~dp0"
echo Starting Free on http://localhost:8080  (keep this window open, close it to stop)
start "" http://localhost:8080
where python >nul 2>nul && (python -m http.server 8080 & goto :eof)
where py >nul 2>nul && (py -m http.server 8080 & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p 8080 -c-1 & goto :eof)
echo.
echo Could not find Python or Node.js. Install Python from https://www.python.org/downloads/
echo (tick "Add python.exe to PATH" during install), then double-click start.bat again.
pause
