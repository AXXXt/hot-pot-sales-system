@echo off
setlocal

echo Stopping development services on ports 3000 and 5173...

for %%P in (3000 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%A >nul 2>nul
    echo Stopped process %%A on port %%P.
  )
)

echo Done.
endlocal
