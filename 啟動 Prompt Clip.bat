@echo off
setlocal
set "APP=%~dp0prompt-clip-latest.exe"
if exist "%APP%" goto launch
set "APP=%~dp0PromptClipPortable\prompt-clip-latest.exe"
if exist "%APP%" goto launch
set "APP=%~dp0prompt-clip-logo.exe"
if exist "%APP%" goto launch
set "APP=%~dp0PromptClipPortable\prompt-clip-logo.exe"
if exist "%APP%" goto launch
set "APP=%~dp0prompt-clip-current.exe"
if exist "%APP%" goto launch
set "APP=%~dp0PromptClipPortable\prompt-clip-current.exe"
if exist "%APP%" goto launch
set "APP=%~dp0prompt-clip.exe"
if exist "%APP%" goto launch
set "APP=%~dp0PromptClipPortable\prompt-clip.exe"
if not exist "%APP%" (
  echo Prompt Clip portable app was not found.
  echo Run scripts\package-portable.ps1 first, or place a Prompt Clip executable beside this file.
  pause
  exit /b 1
)
:launch
start "" "%APP%"
