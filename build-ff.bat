@echo off
setlocal

set NAME=a-lovely-day
set DIST=dist
set OUT=%DIST%\%NAME%-firefox.xpi
set TMP=_build_tmp_ff

if not exist %DIST% mkdir %DIST%
if exist %OUT% del %OUT%
if exist %TMP% rmdir /s /q %TMP%
mkdir %TMP%

:: Dung manifest-mv2.json cho Firefox
copy manifest-mv2.json %TMP%\manifest.json > nul
copy content.js        %TMP%\              > nul
copy popup.html        %TMP%\              > nul
copy popup.js          %TMP%\              > nul
copy background.js     %TMP%\              > nul
xcopy icons    %TMP%\icons\    /e /i /q > nul
xcopy _locales %TMP%\_locales\ /e /i /q > nul

powershell -NoProfile -Command "Compress-Archive -Path '%TMP%\*' -DestinationPath '%OUT%' -Force"

rmdir /s /q %TMP%
echo [OK] %OUT%
