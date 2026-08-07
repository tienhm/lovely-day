@echo off
setlocal

set NAME=a-lovely-day
set DIST=dist
set OUT=%DIST%\%NAME%-chrome.zip
set TMP=_build_tmp_ch

if not exist %DIST% mkdir %DIST%
if exist %OUT% del %OUT%
if exist %TMP% rmdir /s /q %TMP%
mkdir %TMP%

copy manifest.json     %TMP%\manifest.json > nul
copy content.js        %TMP%\              > nul
copy popup.html        %TMP%\              > nul
copy popup.js          %TMP%\              > nul
copy background.js     %TMP%\              > nul
xcopy icons    %TMP%\icons\    /e /i /q > nul
xcopy _locales %TMP%\_locales\ /e /i /q > nul

:: Strip scripts khoi manifest (Chrome/Edge chi dung service_worker trong MV3)
powershell -NoProfile -Command "$f='%TMP%\manifest.json'; $m=Get-Content $f -Raw|ConvertFrom-Json; $m.background.PSObject.Properties.Remove('scripts'); [IO.File]::WriteAllText((Resolve-Path $f),($m|ConvertTo-Json -Depth 10))"

powershell -NoProfile -Command "Compress-Archive -Path '%TMP%\*' -DestinationPath '%OUT%' -Force"

rmdir /s /q %TMP%
echo [OK] %OUT%
