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

# 2. Register in Windows Registry (Chrome, Edge, Brave)
Write-Host "  [2/5] 🛡️ ثبت در رجیستری ویندوز برای پایداری افزونه..." -ForegroundColor Yellow
$extId = "ideaoieajoamlhieondehojgkobnigdk"
$regRoots = @(
    "HKCU:\Software\Google\Chrome\Extensions\$extId",
    "HKCU:\Software\Microsoft\Edge\Extensions\$extId",
    "HKCU:\Software\BraveSoftware\Brave-Browser\Extensions\$extId"
)
foreach ($reg in $regRoots) {
    try {
        if (-not (Test-Path $reg)) {
            New-Item -Path $reg -Force | Out-Null
        }
        Set-ItemProperty -Path $reg -Name "path" -Value $targetDir -Force
    } catch {}
}
Write-Host "  [✔] کلیدهای رجیستری با موفقیت پیکربندی شدند." -ForegroundColor Green

# 3. Detect Installed Chromium Browsers
Write-Host "  [3/5] 🔍 جستجوی مرورگرهای نصب‌شده..." -ForegroundColor Yellow

$browserPaths = @(
    @{ Name = "Google Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"; Proc = "chrome" },
    @{ Name = "Google Chrome (x86)"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"; Proc = "chrome" },
    @{ Name = "Google Chrome (User)"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"; Proc = "chrome" },
    @{ Name = "Brave Browser"; Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"; Proc = "brave" },
    @{ Name = "Brave Browser (User)"; Path = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe"; Proc = "brave" },
    @{ Name = "Microsoft Edge"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"; Proc = "msedge" },
    @{ Name = "Microsoft Edge"; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"; Proc = "msedge" },
    @{ Name = "Vivaldi"; Path = "$env:LOCALAPPDATA\Vivaldi\Application\vivaldi.exe"; Proc = "vivaldi" }
)

$selectedBrowser = $null
foreach ($b in $browserPaths) {
    if (Test-Path $b.Path) {
        $selectedBrowser = $b
        break
    }
}

# 4. Create and Update Shortcuts (Permanent Activation)
Write-Host "  [4/5] 🔗 بروزرسانی و ایجاد شورتکات‌های مرورگر..." -ForegroundColor Yellow
$desktopPath = [Environment]::GetFolderPath("Desktop")
$startMenuPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"

if ($selectedBrowser) {
    try {
        $wshShell = New-Object -ComObject WScript.Shell
        
        # A. Dedicated shortcut
        $shortcutPath = Join-Path $desktopPath "مرورگر با راستین RTL.lnk"
        $shortcut = $wshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $selectedBrowser.Path
        $shortcut.Arguments = "--load-extension=`"$targetDir`""
        $shortcut.Description = "اجرای مرورگر همراه با افزونه فعال راستین RTL"
        $shortcut.Save()

        # B. Patch Desktop Chrome shortcut if exists
        $userChromeLnk = Join-Path $desktopPath "Google Chrome.lnk"
        if (Test-Path $userChromeLnk) {
            $sc = $wshShell.CreateShortcut($userChromeLnk)
            $sc.Arguments = "--load-extension=`"$targetDir`""
            $sc.Save()
        }

        # C. Patch Start Menu Chrome shortcut if exists
        $startChromeLnk = Join-Path $startMenuPath "Google Chrome.lnk"
        if (Test-Path $startChromeLnk) {
            $sc = $wshShell.CreateShortcut($startChromeLnk)
            $sc.Arguments = "--load-extension=`"$targetDir`""
            $sc.Save()
        }
        
        Write-Host "  [✔] شورتکات‌های دسکتاپ و استارت منو با افزونه فعال پیکربندی شدند." -ForegroundColor Green
    } catch {}
}

# 5. Launch Browser with Extension Activated
Write-Host "  [5/5] 🚀 راه‌اندازی مرورگر و فعال‌سازی بلادرنگ افزونه..." -ForegroundColor Yellow

if ($selectedBrowser) {
    # If browser is running, close existing instance to ensure fresh clean launch with arguments
    $procName = $selectedBrowser.Proc
    $runningProcs = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($runningProcs) {
        Write-Host "  [!] مرورگر $($selectedBrowser.Name) باز بود؛ در حال بستن برای اعمال تغییرات..." -ForegroundColor Yellow
        Stop-Process -Name $procName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    }

    # Launch browser with extension loaded directly
    $launchArgs = @(
        "--load-extension=`"$targetDir`"",
        "https://fa.wikipedia.org/wiki/%D8%B5%D9%81%D8%AD%D9%87%D9%94_%D8%A7%D8%B5%D9%84%DB%8C"
    )
    Start-Process -FilePath $selectedBrowser.Path -ArgumentList $launchArgs

    Write-Host ""
    Write-Host "  ===============================================================" -ForegroundColor Green
    Write-Host "     🎉 افزونه راستین RTL با موفقیت روی مرورگر نصب و فعال شد!" -ForegroundColor Green
    Write-Host "  ===============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ✅ مرورگر شما همراه با افزونه فعال باز شد." -ForegroundColor White
    Write-Host "  ✅ از این پس با هر بار کلیک روی شورتکات مرورگر، افزونه فعال خواهد بود." -ForegroundColor White
    Write-Host ""
    Write-Host "  ✨ از وبگردی با چیدمان و فونت زیبای فارسی لذت ببرید!" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  [!] مرورگر کرومیومی به‌صورت خودکار پیدا نشد." -ForegroundColor Yellow
    Write-Host "      مسیر پوشه افزونه: $targetDir" -ForegroundColor Cyan
}
