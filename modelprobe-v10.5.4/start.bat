@echo off
set PORT=8080
if not "%1"=="" set PORT=%1
echo   Building ModelProbe v10.5.5...
python build.py
if errorlevel 1 ( echo   Build failed ^— check Python 3 is installed & pause & exit /b 1 )
python serve.py %PORT%
if errorlevel 1 ( echo   Serve failed & pause )
