# ==============================================================================
#  ✨ Rastin RTL - One-Line Automated Installer for Windows (PowerShell)
#  افزونه راستین RTL - اسکریپت نصب و راه‌اندازی خودکار مرورگر
#  Usage:
#    irm https://raw.githubusercontent.com/Mancity1383/Rastin-RTL/main/install.ps1 | iex
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "  ===============================================================" -ForegroundColor Cyan
Write-Host "     ✨ راستین RTL (Rastin RTL) - نصب و راه‌اندازی خودکار" -ForegroundColor Green
Write-Host "     طراحی شده برای مرورگرهای Chrome, Brave, Edge, Vivaldi" -ForegroundColor DarkGray
Write-Host "  ===============================================================" -ForegroundColor Cyan
Write-Host ""

$repoOwner = "Mancity1383"
$repoName  = "Rastin-RTL"
$branch    = "main"

# 1. Determine Extension Directory (Local vs Remote execution)
$targetDir = $PSScriptRoot

$isLocal = $false
if (-not [string]::IsNullOrWhiteSpace($targetDir) -and (Test-Path (Join-Path $targetDir "manifest.json"))) {
    $isLocal = $true
} else {
    $targetDir = Join-Path $env:LOCALAPPDATA "Rastin-RTL"
}

if (-not $isLocal) {
    Write-Host "  [1/4] 📥 در حال دانلود آخرین نسخه افزونه از گیت‌هاب..." -ForegroundColor Yellow
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $zipUrl = "https://github.com/$repoOwner/$repoName/archive/refs/heads/$branch.zip"
    $zipFile = Join-Path $env:TEMP "Rastin-RTL-$branch.zip"
    $tempExtract = Join-Path $env:TEMP "Rastin-RTL-Extract"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
        
        if (Test-Path $tempExtract) { Remove-Item -Path $tempExtract -Recurse -Force }
        Expand-Archive -Path $zipFile -DestinationPath $tempExtract -Force

        $extractedRoot = Join-Path $tempExtract "$repoName-$branch"
        if (-not (Test-Path $extractedRoot)) {
            $extractedRoot = (Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1).FullName
        }

        Copy-Item -Path "$extractedRoot\*" -Destination $targetDir -Recurse -Force
        Remove-Item -Path $zipFile -Force -ErrorAction SilentlyContinue
        Remove-Item -Path $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  [✔] افزونه با موفقیت دریافت و در مسیر زیر مستقر شد:" -ForegroundColor Green
        Write-Host "      $targetDir" -ForegroundColor DarkCyan
    } catch {
        Write-Host "  [!] خطا در دانلود مستقیم زیپ. تلاش برای کلون با Git..." -ForegroundColor Yellow
        if (Get-Command git -ErrorAction SilentlyContinue) {
            git clone "https://github.com/$repoOwner/$repoName.git" $targetDir
        } else {
            Write-Host "  [❌] خطا: دانلود با شکست مواجه شد. لطفاً اتصال اینترنت را بررسی کنید." -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "  [1/4] 📁 استفاده از سورس موجود در این پوشه:" -ForegroundColor Green
    Write-Host "      $targetDir" -ForegroundColor DarkCyan
}

# 2. Copy Path to Windows Clipboard
try {
    Set-Clipboard -Value $targetDir
    Write-Host "  [2/4] 📋 مسیر پوشه افزونه به‌طور خودکار در کلیپ‌بورد کپی شد." -ForegroundColor Green
} catch {
    # Clipboard might fail in non-interactive sessions
}

# 3. Detect Installed Chromium Browsers
Write-Host "  [3/4] 🔍 جستجوی مرورگرهای نصب‌شده..." -ForegroundColor Yellow

$browserPaths = @(
    @{ Name = "Google Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; ExtUrl = "chrome://extensions" },
    @{ Name = "Google Chrome (x86)"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; ExtUrl = "chrome://extensions" },
    @{ Name = "Google Chrome (User)"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; ExtUrl = "chrome://extensions" },
    @{ Name = "Brave Browser"; Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"; ExtUrl = "brave://extensions" },
    @{ Name = "Brave Browser (User)"; Path = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"; ExtUrl = "brave://extensions" },
    @{ Name = "Microsoft Edge"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; ExtUrl = "edge://extensions" },
    @{ Name = "Microsoft Edge"; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; ExtUrl = "edge://extensions" },
    @{ Name = "Vivaldi"; Path = "$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe"; ExtUrl = "vivaldi://extensions" }
)

$selectedBrowser = $null
foreach ($b in $browserPaths) {
    if (Test-Path $b.Path) {
        $selectedBrowser = $b
        break
    }
}

# 4. Create Desktop Shortcut for Quick Launch
$desktopPath = [Environment]::GetFolderPath("Desktop")
if (Test-Path $desktopPath) {
    try {
        $wshShell = New-Object -ComObject WScript.Shell
        $shortcutPath = Join-Path $desktopPath "مرورگر با راستین RTL.lnk"
        $shortcut = $wshShell.CreateShortcut($shortcutPath)
        
        if ($selectedBrowser) {
            $shortcut.TargetPath = $selectedBrowser.Path
            $shortcut.Arguments = "--load-extension=`"$targetDir`""
            $shortcut.Description = "اجرای مرورگر به همراه افزونه راستین RTL"
            $shortcut.Save()
            Write-Host "  [✔] میانبر اختصاصی روی دسکتاپ ساخته شد: 'مرورگر با راستین RTL'" -ForegroundColor Green
        }
    } catch {
        # Non-critical, continue
    }
}

# 5. Launch Browser with Extension Loaded
Write-Host "  [4/4] 🚀 در حال راه‌اندازی مرورگر و لود خودکار افزونه..." -ForegroundColor Yellow

if ($selectedBrowser) {
    Write-Host "  [✔] مرورگر یافت شد: $($selectedBrowser.Name)" -ForegroundColor Green
    
    # Launch browser with the extension loaded
    $launchArgs = @(
        "--load-extension=`"$targetDir`"",
        $selectedBrowser.ExtUrl
    )
    Start-Process -FilePath $selectedBrowser.Path -ArgumentList $launchArgs

    Write-Host ""
    Write-Host "  ===============================================================" -ForegroundColor Green
    Write-Host "     🎉 نصب و لود خودکار با موفقیت انجام شد!" -ForegroundColor Green
    Write-Host "  ===============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  💡 برای ماندگار شدن دائمی افزونه در مرورگر (فقط همین یک بار):" -ForegroundColor White
    Write-Host "     ۱. در صفحه باز شده مرورگر، کلید Developer mode (بالا سمت راست) را روشن کنید." -ForegroundColor Cyan
    Write-Host "     ۲. روی دکمه 'Load unpacked' (یا بارگیری بازنشده) کلیک کنید." -ForegroundColor Cyan
    Write-Host "     ۳. در پنجره انتخاب پوشه، کلید [Ctrl + V] را بزنید و سپس Enter کنید." -ForegroundColor Yellow
    Write-Host "        (مسیر پوشه افزونه قبلاً در کلیپ‌بورد شما کپی شده است!)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  ✨ از وبگردی با چیدمان و فونت زیبای فارسی لذت ببرید!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  [!] مرورگر کرومیومی به‌صورت خودکار پیدا نشد." -ForegroundColor Yellow
    Write-Host "      مسیر پوشه افزونه: $targetDir" -ForegroundColor Cyan
    Write-Host "      کافیست در مرورگر خود به آدرس chrome://extensions بروید، Load unpacked را بزنید و این مسیر را پیست کنید." -ForegroundColor White
}
