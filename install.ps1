# ==============================================================================
#  ✨ Rastin RTL - 100% Automated One-Line Installer & Activator
#  نصب و فعال‌سازی تمام‌خودکار افزونه راستین RTL بدون نیاز به تنظیمات دستی
#  Usage:
#    irm https://raw.githubusercontent.com/Mancity1383/Rastin-RTL/main/install.ps1 | iex
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "  ===============================================================" -ForegroundColor Cyan
Write-Host "     ✨ راستین RTL (Rastin RTL) - نصب و فعال‌سازی خودکار" -ForegroundColor Green
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
    Write-Host "  [1/5] 📥 در حال دریافت آخرین نسخه افزونه از گیت‌هاب..." -ForegroundColor Yellow
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
        Write-Host "  [✔] افزونه با موفقیت دریافت و مستقر شد:" -ForegroundColor Green
        Write-Host "      $targetDir" -ForegroundColor DarkCyan
    } catch {
        Write-Host "  [!] خطا در دانلود زیپ؛ تلاش برای کلون با Git..." -ForegroundColor Yellow
        if (Get-Command git -ErrorAction SilentlyContinue) {
            git clone "https://github.com/$repoOwner/$repoName.git" $targetDir
        } else {
            Write-Host "  [❌] خطا در دانلود سورس. لطفاً اتصال اینترنت را بررسی کنید." -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "  [1/5] 📁 استفاده از سورس موجود در این پوشه:" -ForegroundColor Green
    Write-Host "      $targetDir" -ForegroundColor DarkCyan
}

# 2. Detect Installed Chromium Browsers
Write-Host "  [2/4] 🔍 بررسی و شناسایی مرورگر نصب‌شده..." -ForegroundColor Yellow

$browserPaths = @(
    @{ Name = "Google Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
    @{ Name = "Google Chrome (x86)"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" },
    @{ Name = "Google Chrome (User)"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" },
    @{ Name = "Brave Browser"; Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe" },
    @{ Name = "Brave Browser (User)"; Path = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" },
    @{ Name = "Microsoft Edge"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" },
    @{ Name = "Microsoft Edge"; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
    @{ Name = "Vivaldi"; Path = "$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe" }
)

$selectedBrowser = $null
foreach ($b in $browserPaths) {
    if (Test-Path $b.Path) {
        $selectedBrowser = $b
        break
    }
}

if ($selectedBrowser) {
    Write-Host "  [✔] مرورگر شناسایی شد: $($selectedBrowser.Name)" -ForegroundColor Green
}

# 3. Copy Extension Path to Clipboard
Write-Host "  [3/4] 📋 کپی مسیر پوشه افزونه در کلیپ‌بورد سیستم..." -ForegroundColor Yellow

try {
    Set-Clipboard -Value $targetDir
    Write-Host "  [✔] مسیر در کلیپ‌بورد ذخیره شد (آماده Paste با Ctrl+V)." -ForegroundColor Green
} catch {}

# Optional: Clean any previous dedicated test shortcut if it existed
try {
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $dedicatedLnk = Join-Path $desktopPath "مرورگر با راستین RTL.lnk"
    if (Test-Path $dedicatedLnk) { Remove-Item $dedicatedLnk -Force -ErrorAction SilentlyContinue }
} catch {}

# 5. Open Browser directly to Extensions Management Page
Write-Host "  [4/4] 🚀 باز کردن صفحه مدیریت افزونه‌ها در مرورگر..." -ForegroundColor Yellow

$extUrl = "chrome://extensions"
if ($selectedBrowser) {
    if ($selectedBrowser.Name -like "*Edge*") {
        $extUrl = "edge://extensions"
    } elseif ($selectedBrowser.Name -like "*Brave*") {
        $extUrl = "brave://extensions"
    }
    
    Start-Process -FilePath $selectedBrowser.Path -ArgumentList $extUrl
} else {
    Start-Process "chrome://extensions" -ErrorAction SilentlyContinue
}

# Open folder in Explorer for easy Drag & Drop
try {
    Start-Process explorer.exe -ArgumentList "`"$targetDir`""
} catch {}

Write-Host ""
Write-Host "  ===============================================================" -ForegroundColor Green
Write-Host "     🎉 فایل‌های افزونه با موفقیت روی سیستم شما مستقر شدند!" -ForegroundColor Green
Write-Host "  ===============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  📌 مسیر پوشه افزونه (قبلاً در کلیپ‌بورد کپی شده است):" -ForegroundColor Cyan
Write-Host "     $targetDir" -ForegroundColor White
Write-Host ""
Write-Host "  ⚡ فقط ۲ کلیک ساده در صفحه باز شده مرورگر برای نصب دائمی روی اکانت:" -ForegroundColor Yellow
Write-Host "     ۱. کلید [Developer mode] (بالا سمت راست) را روشن کنید." -ForegroundColor White
Write-Host "     ۲. روی دکمه [Load unpacked] (بارگیری بازنشده) کلیک کنید." -ForegroundColor White
Write-Host "     ۳. در پنجره باز شده، کلید [Ctrl + V] را بزنید و سپس دکمه Select Folder را انتخاب کنید." -ForegroundColor Cyan
Write-Host "        (همچنین می‌توانید پوشه باز شده در ویندوز را مستقیماً با ماوس به داخل مرورگر بکشید!)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ✅ با این کار، افزونه برای همیشه و رسمی روی اکانت کروم شما ذخیره می‌شود" -ForegroundColor Green
Write-Host "     و با ریستارت یا باز کردن عادی مرورگر همیشه فعال خواهد ماند." -ForegroundColor Green
Write-Host ""
