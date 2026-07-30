@echo off
setlocal

set NAME=a-lovely-day
set DIST=dist
set ZIP=%DIST%\%NAME%-firefox.zip
set OUT=%DIST%\%NAME%-firefox.xpi
set TMP=_build_tmp_ff

if not exist %DIST% mkdir %DIST%
if exist %OUT% del %OUT%
if exist %ZIP% del %ZIP%
if exist %TMP% rmdir /s /q %TMP%
mkdir %TMP%

copy manifest.json     %TMP%\manifest.json > nul
copy content.js        %TMP%\              > nul
copy popup.html        %TMP%\              > nul
copy popup.js          %TMP%\              > nul
copy background.js     %TMP%\              > nul
xcopy icons    %TMP%\icons\    /e /i /q > nul
xcopy _locales %TMP%\_locales\ /e /i /q > nul

:: Strip service_worker khoi manifest (Firefox khong ho tro, dung scripts thay)
powershell -NoProfile -Command "$f='%TMP%\manifest.json'; $m=Get-Content $f -Raw|ConvertFrom-Json; $m.background.PSObject.Properties.Remove('service_worker'); [IO.File]::WriteAllText((Resolve-Path $f),($m|ConvertTo-Json -Depth 10))"

:: Tao ZIP voi forward slashes (Firefox yeu cau)
powershell -NoProfile -ExecutionPolicy Bypass -File build-ff.ps1 -Src "%TMP%" -Dst "%ZIP%"

rename %ZIP% %NAME%-firefox.xpi

rmdir /s /q %TMP%
echo [OK] %OUT%
