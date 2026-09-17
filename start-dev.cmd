@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "ADMIN=%ROOT%admin-web"
set "COMPOSE_FILE=%ROOT%docker-compose.dev.yml"

if not exist "%BACKEND%\package.json" (
  echo [ERROR] Backend package.json not found: %BACKEND%
  pause
  exit /b 1
)

if not exist "%ADMIN%\package.json" (
  echo [ERROR] Admin web package.json not found: %ADMIN%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js and npm are required. Install Node.js, then run this script again.
  pause
  exit /b 1
)

if not exist "%BACKEND%\node_modules" (
  echo [ERROR] Backend dependencies are missing. Run: cd /d "%BACKEND%" ^&^& npm install
  pause
  exit /b 1
)

if not exist "%ADMIN%\node_modules" (
  echo [ERROR] Admin web dependencies are missing. Run: cd /d "%ADMIN%" ^&^& npm install
  pause
  exit /b 1
)

call :start_infrastructure
if errorlevel 1 (
  pause
  exit /b 1
)

echo Starting B2B development services...
start "B2B Backend - http://127.0.0.1:3000" /D "%BACKEND%" cmd.exe /d /k "npm run dev"
start "B2B Admin - http://127.0.0.1:5173" /D "%ADMIN%" cmd.exe /d /k "npm run dev"

echo.
echo Backend: http://127.0.0.1:3000
echo Admin:   http://127.0.0.1:5173
echo.
echo Two terminal windows were opened. Close either window to stop that service.
endlocal
exit /b 0

:start_infrastructure
if not exist "%COMPOSE_FILE%" (
  echo [ERROR] Docker Compose file not found: %COMPOSE_FILE%
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Docker Desktop is required for MySQL and Redis.
  echo Install Docker Desktop or start MySQL on 127.0.0.1:3307 and Redis on 127.0.0.1:6379 manually.
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    echo Starting Docker Desktop...
    start "Docker Desktop" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  ) else (
    echo [ERROR] Docker Desktop is installed but its engine is not running.
    echo Start Docker Desktop, wait until it is ready, then run this script again.
    exit /b 1
  )
)

echo Waiting for Docker engine...
set "DOCKER_READY=0"
for /l %%I in (1,1,60) do (
  docker info >nul 2>nul
  if not errorlevel 1 (
    set "DOCKER_READY=1"
    goto docker_ready
  )
  timeout /t 1 /nobreak >nul
)

:docker_ready
if "%DOCKER_READY%"=="0" (
  echo [ERROR] Docker engine did not become ready within 60 seconds.
  exit /b 1
)

echo Starting MySQL, Redis and MinIO...
docker compose -f "%COMPOSE_FILE%" up -d --wait mysql redis minio
if errorlevel 1 (
  echo [ERROR] Infrastructure startup failed. Check Docker Desktop and port usage for 3307, 6379 and 9000.
  exit /b 1
)
exit /b 0
