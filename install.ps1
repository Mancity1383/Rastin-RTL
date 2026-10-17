#requires -Version 5.1
<#
Prepares a stable local installation. Enable it via Developer mode > Load unpacked.
irm https://raw.githubusercontent.com/Mancity1383/Rastin-RTL/main/install.ps1 | iex
.\install.ps1 -Source . -Browser edge -NoOpen
#>
[CmdletBinding()]
param(
    [string]$Destination,
    [string]$Source,
    [ValidateSet('auto', 'chrome', 'edge', 'brave', 'vivaldi')]
    [string]$Browser = 'auto',
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$installOwnedPaths = @{}
$installStage = $null
$installTemporary = $null
$installBackup = $null
$installKeepBackup = $false

function Get-InstallFullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.IndexOfAny([char[]]'*?') -ge 0) { throw 'A non-empty path without wildcards is required.' }
    $pathProvider = $null
    $pathDrive = $null
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path, [ref]$pathProvider, [ref]$pathDrive)
    if ($pathProvider.Name -ne 'FileSystem') { throw 'Only filesystem paths are supported.' }
    $full = [IO.Path]::GetFullPath($full)
    if ($full.TrimEnd([char[]]'\/') -eq [IO.Path]::GetPathRoot($full).TrimEnd([char[]]'\/')) { throw "A filesystem root cannot be used: $full" }
    return $full.TrimEnd([char[]]'\/')
}
function Test-InstallWithin([string]$Path, [string]$Root) {
    return $Path.Equals($Root, [StringComparison]::OrdinalIgnoreCase) -or $Path.StartsWith($Root.TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
function Assert-InstallNoReparse([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links and junctions are not supported: $current" }
        }
        $parent = [IO.Path]::GetDirectoryName($current.TrimEnd([char[]]'\/'))
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
function Assert-InstallTree([string]$Root) {
    Assert-InstallNoReparse $Root
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "Directory is missing: $Root" }
    $pendingDirectories = New-Object 'System.Collections.Generic.Stack[string]'
    $pendingDirectories.Push($Root)
    while ($pendingDirectories.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -LiteralPath ($pendingDirectories.Pop()) -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links and junctions are not supported: $($item.FullName)" }
            if (-not (Test-InstallWithin ([IO.Path]::GetFullPath($item.FullName)) $Root)) { throw 'An asset escaped its directory.' }
            if ($item.PSIsContainer) { $pendingDirectories.Push($item.FullName) }
        }
    }
}
function Assert-InstallFile([string]$Root, [string]$Relative, [string]$Base = '') {
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -match '^[\\/]' -or $Relative.Contains(':') -or $Relative.IndexOfAny([char[]]'*?') -ge 0) { throw "Invalid runtime path: $Relative" }
    $full = [IO.Path]::GetFullPath([IO.Path]::Combine($Root, $Base, $Relative.Replace('/', '\')))
    if (-not (Test-InstallWithin $full $Root)) { throw "Runtime path escapes the extension: $Relative" }
    Assert-InstallNoReparse $full
    if (-not (Test-Path -LiteralPath $full -PathType Leaf) -or (Get-Item -LiteralPath $full).Length -eq 0) { throw "Runtime asset is missing or empty: $Relative" }
}
function Assert-InstallManifestReference([string]$Root, [string]$Relative) {
    if ($Relative -match '(^|[\\/])\.\.([\\/]|$)') { throw "Invalid manifest path: $Relative" }
    Assert-InstallFile $Root $Relative
}
function Assert-InstallRuntime([string]$Root, [switch]$AllowLegacyReaderAssets) {
    Assert-InstallNoReparse $Root
    Assert-InstallFile $Root 'manifest.json'
    try { $manifest = Get-Content -LiteralPath (Join-Path $Root 'manifest.json') -Raw | ConvertFrom-Json }
    catch { throw "Invalid manifest JSON: $($_.Exception.Message)" }
    if ($manifest.manifest_version -ne 3 -or $manifest.name -ne 'Rastin RTL' -or -not $manifest.version -or -not $manifest.background.service_worker -or -not $manifest.action.default_popup -or @($manifest.content_scripts).Count -eq 0) { throw 'A complete Rastin RTL Manifest V3 extension is required.' }
    if ($manifest.version -isnot [string] -or $manifest.version -notmatch '^\d+(?:\.\d+){0,3}$') { throw 'Invalid Chrome extension version.' }
    $nonzeroVersion = $false
    foreach ($component in $manifest.version.Split('.')) {
        $integer = 0
        if (($component.Length -gt 1 -and $component.StartsWith('0')) -or -not [int]::TryParse($component, [ref]$integer) -or $integer -gt 65535) { throw 'Invalid Chrome extension version.' }
        if ($integer -gt 0) { $nonzeroVersion = $true }
    }
    if (-not $nonzeroVersion) { throw 'Invalid Chrome extension version.' }
    foreach ($required in @('background.js', 'ruleset_adblock.json', 'cosmetic_rules.json')) { Assert-InstallFile $Root $required }
    $runtimeDirectories = @('content', 'popup', 'fonts', 'icons')
    $includeReader = -not $AllowLegacyReaderAssets -or (Test-Path -LiteralPath (Join-Path $Root 'reader')) -or (Test-Path -LiteralPath (Join-Path $Root 'vendor'))
    if ($includeReader) {
        $runtimeDirectories += @('reader', 'vendor')
        foreach ($required in @('reader/viewer.html', 'reader/viewer.js', 'reader/viewer.css', 'reader/bridge.js', 'reader/service.js', 'vendor/pdfjs/pdf.mjs', 'vendor/pdfjs/pdf.worker.mjs')) { Assert-InstallFile $Root $required }
    }
    foreach ($directory in $runtimeDirectories) { Assert-InstallTree (Join-Path $Root $directory) }
    Assert-InstallManifestReference $Root $manifest.background.service_worker
    Assert-InstallManifestReference $Root $manifest.action.default_popup
    foreach ($iconMap in @($manifest.icons, $manifest.action.default_icon)) {
        if ($iconMap -is [string]) { Assert-InstallManifestReference $Root $iconMap }
        elseif ($null -ne $iconMap) { foreach ($property in $iconMap.PSObject.Properties) { Assert-InstallManifestReference $Root ([string]$property.Value) } }
    }
    foreach ($script in @($manifest.content_scripts)) {
        if (@($script.js).Count -eq 0 -and @($script.css).Count -eq 0) { throw 'An empty content-script entry is invalid.' }
        foreach ($reference in @($script.js) + @($script.css)) { if ($null -ne $reference) { Assert-InstallManifestReference $Root ([string]$reference) } }
    }
    foreach ($rules in @($manifest.declarative_net_request.rule_resources)) { if ($null -ne $rules) { Assert-InstallManifestReference $Root ([string]$rules.path) } }
    $runtimeFiles = @(
        Get-Item -LiteralPath (Join-Path $Root 'manifest.json')
        Get-Item -LiteralPath (Join-Path $Root 'background.js')
        Get-Item -LiteralPath (Join-Path $Root 'ruleset_adblock.json')
        Get-Item -LiteralPath (Join-Path $Root 'cosmetic_rules.json')
    )
    foreach ($directory in $runtimeDirectories) {
        $runtimeFiles += @(Get-ChildItem -LiteralPath (Join-Path $Root $directory) -File -Recurse)
    }
    foreach ($group in @($manifest.web_accessible_resources)) {
        foreach ($reference in @($group.resources)) {
            if ($reference -match '(^|[\\/])\.\.([\\/]|$)' -or $reference -match '^[\\/]' -or $reference.Contains(':')) { throw "Invalid web-accessible path: $reference" }
            if ($reference.IndexOfAny([char[]]'*?') -lt 0) { Assert-InstallManifestReference $Root ([string]$reference) }
            else {
                $pattern = '^' + [regex]::Escape($reference.Replace('\', '/')).Replace('\*', '.*').Replace('\?', '.') + '$'
                $matchingAssets = @($runtimeFiles | Where-Object { $_.FullName.Substring($Root.Length + 1).Replace('\', '/') -match $pattern })
                if ($matchingAssets.Count -eq 0) { throw "Web-accessible assets are missing: $reference" }
            }
        }
    }
    foreach ($file in $runtimeFiles) {
        if ($file.Extension -eq '.json') {
            try { [void](Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json) }
            catch { throw "Invalid runtime JSON: $($file.Name)" }
        }
        if ($file.Extension -in @('.js', '.mjs')) {
            $contents = Get-Content -LiteralPath $file.FullName -Raw
            $base = [IO.Path]::GetDirectoryName($file.FullName).Substring($Root.Length).TrimStart([char[]]'\/')
            foreach ($match in [regex]::Matches($contents, 'importScripts\s*\(([^)]*)\)')) {
                foreach ($argument in $match.Groups[1].Value.Split(',')) {
                    if ($argument -match '^\s*["'']([^"'']+)["'']\s*$') { Assert-InstallFile $Root $matches[1] $base }
                }
            }
            foreach ($match in [regex]::Matches($contents, '(?:chrome|browser)\.runtime\.getURL\s*\(\s*["'']([^"'']+)["'']\s*\)')) {
                Assert-InstallManifestReference $Root $match.Groups[1].Value
            }
            foreach ($match in [regex]::Matches($contents, '\b(?:import|export)\s+(?:[^;\r\n]*?\s+from\s*)?["'']([^"''\r\n]+)["'']')) {
                $reference = $match.Groups[1].Value
                if (-not $reference.StartsWith('//') -and $reference -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*:') { Assert-InstallFile $Root $reference $base }
            }
        }
    }
    # HTML and CSS include dependencies not listed directly in the manifest.
    foreach ($directory in $runtimeDirectories) {
        foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $Root $directory) -File -Recurse)) {
            if ($file.Extension -notin @('.html', '.css')) { continue }
            $contents = Get-Content -LiteralPath $file.FullName -Raw
            $base = [IO.Path]::GetDirectoryName($file.FullName).Substring($Root.Length).TrimStart([char[]]'\/')
            $pattern = 'url\(\s*["'']?([^"'')\s]+)["'']?\s*\)'
            if ($file.Extension -eq '.html') { $pattern = '(?:src|href)\s*=\s*["'']([^"'']*)["'']' }
            $assetMatches = @([regex]::Matches($contents, $pattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase))
            if ($file.Extension -eq '.css') { $assetMatches += @([regex]::Matches($contents, '@import\s+["'']([^"'']+)["'']', [Text.RegularExpressions.RegexOptions]::IgnoreCase)) }
            foreach ($match in $assetMatches) {
                $reference = $match.Groups[1].Value
                if (-not $reference -or $reference.StartsWith('#') -or $reference.StartsWith('//') -or $reference -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') { continue }
                $reference = ($reference -split '[?#]', 2)[0]
                if ($reference) { Assert-InstallFile $Root $reference $base }
            }
        }
    }
    return $manifest
}
function New-InstallOwnedDirectory([string]$Parent, [string]$Label) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([char[]]'\/')
    Assert-InstallNoReparse $parentFull
    $candidate = Get-InstallFullPath (Join-Path $parentFull ('.rastin-' + $Label + '-' + [guid]::NewGuid().ToString('N')))
    if ([IO.Path]::GetDirectoryName($candidate) -ne $parentFull -or (Test-Path -LiteralPath $candidate)) { throw 'Unsafe temporary path.' }
    [IO.Directory]::CreateDirectory($candidate) | Out-Null
    $installOwnedPaths[$candidate] = $parentFull
    return $candidate
}
function Remove-InstallOwnedDirectory([string]$Path) {
    if (-not $Path -or -not $installOwnedPaths.ContainsKey($Path) -or -not (Test-Path -LiteralPath $Path)) { return }
    $full = Get-InstallFullPath $Path
    if ($full -ne $Path -or [IO.Path]::GetDirectoryName($full) -ne $installOwnedPaths[$Path]) { throw "Unsafe cleanup path: $Path" }
    Assert-InstallTree $full
    Remove-Item -LiteralPath $full -Recurse -Force
    $installOwnedPaths.Remove($Path)
}
function Assert-InstallArchive([string]$ZipPath) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $roots = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $expandedSize = [long]0
        if ($archive.Entries.Count -eq 0 -or $archive.Entries.Count -gt 100000) { throw 'Invalid archive entry count.' }
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if (-not $name -or $name.StartsWith('/') -or $name.Contains(':')) { throw "Unsafe archive entry: $name" }
            $segments = $name.TrimEnd('/').Split('/')
            if ($segments -contains '..' -or $segments -contains '.' -or $segments -contains '' -or $name.IndexOfAny([char[]]'*?') -ge 0 -or $name -match '[\x00-\x1f]') { throw "Unsafe archive entry: $name" }
            foreach ($segment in $segments) {
                if ($segment -match '[ .]$' -or $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw "Unsafe Windows archive path: $name" }
            }
            if (-not $seen.Add($name.TrimEnd('/'))) { throw "Duplicate archive entry: $name" }
            $attributes = [long]$entry.ExternalAttributes
            if ((($attributes -shr 16) -band 0xF000) -eq 0xA000 -or ($attributes -band 0x400) -ne 0) { throw "Archive links are not allowed: $name" }
            if ($segments.Length -lt 2 -and -not $name.EndsWith('/')) { throw 'The archive must have one repository directory.' }
            [void]$roots.Add($segments[0])
            $expandedSize += $entry.Length
            if ($expandedSize -gt 1GB) { throw 'The archive is too large.' }
        }
        if ($roots.Count -ne 1 -or -not $roots.Contains('Rastin-RTL-main')) { throw 'Expected Rastin-RTL-main archive directory is missing.' }
    } finally { $archive.Dispose() }
}
function Get-InstallBrowser([string]$Choice) {
    $programRoots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'), $env:LOCALAPPDATA) | Where-Object { $_ }
    $browserTypes = @(
        @{ Id = 'chrome'; Name = 'Google Chrome'; Relative = 'Google\Chrome\Application\chrome.exe'; Url = 'chrome://extensions/' },
        @{ Id = 'edge'; Name = 'Microsoft Edge'; Relative = 'Microsoft\Edge\Application\msedge.exe'; Url = 'edge://extensions/' },
        @{ Id = 'brave'; Name = 'Brave'; Relative = 'BraveSoftware\Brave-Browser\Application\brave.exe'; Url = 'brave://extensions/' },
        @{ Id = 'vivaldi'; Name = 'Vivaldi'; Relative = 'Vivaldi\Application\vivaldi.exe'; Url = 'vivaldi://extensions/' }
    )
    foreach ($type in $browserTypes) {
        if ($Choice -ne 'auto' -and $Choice -ne $type.Id) { continue }
        foreach ($root in $programRoots) {
            $candidate = Join-Path $root $type.Relative
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { return @{ Name = $type.Name; Path = $candidate; Url = $type.Url } }
        }
    }
    return $null
}
try {
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is unavailable. This installer requires Windows.' }
    $installDefault = Get-InstallFullPath (Join-Path $env:LOCALAPPDATA 'Rastin-RTL')
    if ([string]::IsNullOrWhiteSpace($Destination)) { $Destination = $installDefault }
    $installTarget = Get-InstallFullPath $Destination
    Assert-InstallNoReparse $installTarget
    $installParent = [IO.Path]::GetDirectoryName($installTarget)
    Assert-InstallNoReparse $installParent
    if (Test-Path -LiteralPath $installTarget) {
        if (-not (Test-Path -LiteralPath $installTarget -PathType Container)) { throw "Destination is not a directory: $installTarget" }
        $markerPath = Join-Path $installTarget '.rastin-install.json'
        $managed = $false
        if (Test-Path -LiteralPath $markerPath -PathType Leaf) {
            Assert-InstallNoReparse $markerPath
            try { $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json }
            catch { throw 'The installation marker is invalid. Choose a different destination.' }
            $managed = $marker.product -eq 'Rastin-RTL' -and $marker.format -eq 1
            if (-not $managed) { throw 'The destination has an unrecognized installation marker.' }
        }
        if (-not $managed) {
            if (-not $installTarget.Equals($installDefault, [StringComparison]::OrdinalIgnoreCase)) { throw 'The destination exists and is not managed by Rastin RTL. Choose a new folder.' }
            [void](Assert-InstallRuntime $installTarget -AllowLegacyReaderAssets)
            $installKeepBackup = $true
        }
    }
    if ([string]::IsNullOrWhiteSpace($Source) -and $PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -PathType Leaf)) { $Source = $PSScriptRoot }
    if (-not [string]::IsNullOrWhiteSpace($Source)) {
        $installSource = Get-InstallFullPath $Source
        if ((Test-InstallWithin $installTarget $installSource) -or (Test-InstallWithin $installSource $installTarget)) { throw 'Source and destination must be separate directories with no overlap.' }
        [void](Assert-InstallRuntime $installSource)
        Write-Host "Using local source: $installSource" -ForegroundColor Cyan
    } else {
        if (-not $env:TEMP) { throw 'TEMP is unavailable.' }
        $installTemporary = New-InstallOwnedDirectory $env:TEMP 'download'
        $zipPath = Join-Path $installTemporary 'source.zip'
        Write-Host 'Downloading Rastin RTL from GitHub...' -ForegroundColor Cyan
        $previousProtocol = [Net.ServicePointManager]::SecurityProtocol
        try {
            [Net.ServicePointManager]::SecurityProtocol = $previousProtocol -bor [Net.SecurityProtocolType]::Tls12
            $response = Invoke-WebRequest -Uri 'https://codeload.github.com/Mancity1383/Rastin-RTL/zip/refs/heads/main' -OutFile $zipPath -PassThru -UseBasicParsing -TimeoutSec 90 -MaximumRedirection 3
        } finally { [Net.ServicePointManager]::SecurityProtocol = $previousProtocol }
        if (-not $response -or [int]$response.StatusCode -ne 200 -or -not (Test-Path -LiteralPath $zipPath -PathType Leaf) -or (Get-Item -LiteralPath $zipPath).Length -eq 0) { throw 'GitHub did not return a valid archive (HTTP 200 required).' }
        Assert-InstallArchive $zipPath
        $extractPath = Join-Path $installTemporary 'extracted'
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath
        $installSource = Get-InstallFullPath (Join-Path $extractPath 'Rastin-RTL-main')
        [void](Assert-InstallRuntime $installSource)
    }
    # Validate a complete staged runtime before touching the existing installation.
    [IO.Directory]::CreateDirectory($installParent) | Out-Null
    Assert-InstallNoReparse $installParent
    $installStage = New-InstallOwnedDirectory $installParent 'stage'
    foreach ($name in @('manifest.json', 'background.js', 'ruleset_adblock.json', 'cosmetic_rules.json', 'content', 'popup', 'reader', 'vendor', 'fonts', 'icons', 'LICENSE')) {
        $sourcePath = Join-Path $installSource $name
        if ($name -eq 'LICENSE' -and -not (Test-Path -LiteralPath $sourcePath)) { continue }
        Assert-InstallNoReparse $sourcePath
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $installStage $name) -Recurse -Force
    }
    $installedManifest = Assert-InstallRuntime $installStage
    $markerJson = @{ product = 'Rastin-RTL'; format = 1 } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $installStage '.rastin-install.json'), $markerJson, (New-Object Text.UTF8Encoding $false))
    if (Test-Path -LiteralPath $installTarget) {
        Assert-InstallTree $installTarget
        $installBackup = Get-InstallFullPath (Join-Path $installParent ('.rastin-backup-' + [guid]::NewGuid().ToString('N')))
        if ([IO.Path]::GetDirectoryName($installBackup) -ne $installParent -or (Test-Path -LiteralPath $installBackup)) { throw 'Unsafe backup path.' }
        Move-Item -LiteralPath $installTarget -Destination $installBackup
        $installOwnedPaths[$installBackup] = $installParent
    }
    try {
        Assert-InstallTree $installStage
        if ([IO.Path]::GetDirectoryName($installStage) -ne $installParent -or (Test-Path -LiteralPath $installTarget)) { throw 'Destination changed while installing.' }
        Move-Item -LiteralPath $installStage -Destination $installTarget
        $installOwnedPaths.Remove($installStage)
    } catch {
        $publishError = $_
        if ($installBackup -and (Test-Path -LiteralPath $installBackup) -and -not (Test-Path -LiteralPath $installTarget)) {
            Assert-InstallTree $installBackup
            Move-Item -LiteralPath $installBackup -Destination $installTarget
            $installOwnedPaths.Remove($installBackup)
            $installBackup = $null
        }
        throw $publishError
    }
    if ($installBackup -and -not $installKeepBackup) {
        try { Remove-InstallOwnedDirectory $installBackup; $installBackup = $null }
        catch { Write-Warning "Installed successfully; the previous folder was retained at: $installBackup" }
    }
    Write-Host "Rastin RTL $($installedManifest.version) files are ready: $installTarget" -ForegroundColor Green
    if ($installBackup -and $installKeepBackup) { Write-Host "Previous folder preserved at: $installBackup" -ForegroundColor Yellow }
    if (-not $NoOpen) {
        try { Set-Clipboard -Value $installTarget; Write-Host 'The extension folder path was copied to the clipboard.' }
        catch { Write-Warning 'Clipboard is unavailable. Copy the folder path above manually.' }
        $selectedBrowser = Get-InstallBrowser $Browser
        if ($selectedBrowser) {
            try { Start-Process -FilePath $selectedBrowser.Path -ArgumentList $selectedBrowser.Url | Out-Null }
            catch { Write-Warning "Could not open $($selectedBrowser.Name). Open its extensions page manually." }
        } else { Write-Warning 'The selected browser was not found. Open your Chromium browser extensions page manually.' }
        try { Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $installTarget + '"') | Out-Null }
        catch { Write-Warning 'Could not open Explorer. Use the folder path above.' }
    }
    Write-Host 'To enable: open the browser extensions page, turn on Developer mode, then Load unpacked and select this folder.'
    Write-Host 'If already loaded from this path, click Reload and refresh open pages. Keep the installation folder in place.'
} finally {
    foreach ($owned in @($installStage, $installTemporary)) {
        if ($owned) {
            try { Remove-InstallOwnedDirectory $owned }
            catch { Write-Warning "Could not clean temporary directory: $owned" }
        }
    }
}
