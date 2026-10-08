#requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$installer = Join-Path $repo 'install.ps1'
$testRoot = Join-Path $repo ('.installer-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
$oldLocalAppData = $env:LOCALAPPDATA
$oldTemporary = $env:TEMP
$env:LOCALAPPDATA = Join-Path $testRoot 'local app data'
$env:TEMP = Join-Path $testRoot 'temporary downloads'
[IO.Directory]::CreateDirectory($env:LOCALAPPDATA) | Out-Null
[IO.Directory]::CreateDirectory($env:TEMP) | Out-Null
$global:rastinInstallerTest_testCount = 0
$global:rastinInstallerTest_interactiveCalls = 0
$global:rastinInstallerTest_mockStatus = 200
$global:rastinInstallerTest_downloadFixtureZip = $null
$global:rastinInstallerTest_publishFailure = $false
$global:rastinInstallerTest_publishFailureTarget = $null
$installerBlock = [scriptblock]::Create([IO.File]::ReadAllText($installer))
function Set-Clipboard { param($Value) $global:rastinInstallerTest_interactiveCalls++; throw 'Unexpected clipboard operation under -NoOpen.' }
function Start-Process { param($FilePath, $ArgumentList) $global:rastinInstallerTest_interactiveCalls++; throw 'Unexpected process launch under -NoOpen.' }
function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$PassThru, [switch]$UseBasicParsing, $TimeoutSec, $MaximumRedirection)
    if ($Uri -notlike 'https://codeload.github.com/*' -or $TimeoutSec -ne 90 -or -not $PassThru) { throw 'Unexpected download options.' }
    Copy-Item -LiteralPath $global:rastinInstallerTest_downloadFixtureZip -Destination $OutFile
    return [pscustomobject]@{ StatusCode = $global:rastinInstallerTest_mockStatus }
}
function Move-Item {
    param($LiteralPath, $Destination, [switch]$Force)
    if ($global:rastinInstallerTest_publishFailure -and $LiteralPath -like '*\.rastin-stage-*' -and $Destination -eq $global:rastinInstallerTest_publishFailureTarget) {
        $global:rastinInstallerTest_publishFailure = $false
        throw 'Simulated failure publishing the staged runtime.'
    }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
}
function Write-FixtureFile([string]$Root, [string]$Relative, [string]$Text) {
    $path = Join-Path $Root $Relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
    [IO.File]::WriteAllText($path, $Text)
}
function New-Fixture([string]$Name, [string]$Version = '1.0.0') {
    $root = Join-Path $testRoot $Name
    $manifest = @{
        manifest_version = 3; name = 'Rastin RTL'; version = $Version
        background = @{service_worker = 'background.js'}
        action = @{default_popup = 'popup/popup.html'; default_icon = @{'16' = 'icons/icon.png'}}
        icons = @{'16' = 'icons/icon.png'}
        content_scripts = @(@{matches = @('<all_urls>'); js = @('content/main.js'); css = @('content/main.css')})
        declarative_net_request = @{rule_resources = @(@{id = 'main'; enabled = $true; path = 'ruleset_adblock.json'})}
        web_accessible_resources = @(@{resources = @('cosmetic_rules.json', 'fonts/*.woff2'); matches = @('<all_urls>')})
    }
    Write-FixtureFile $root 'manifest.json' ($manifest | ConvertTo-Json -Depth 12)
    Write-FixtureFile $root 'background.js' '// worker'
    Write-FixtureFile $root 'ruleset_adblock.json' '[]'
    Write-FixtureFile $root 'cosmetic_rules.json' '{}'
    Write-FixtureFile $root 'content/main.js' '// content'
    Write-FixtureFile $root 'content/main.css' 'body { color: inherit; }'
    Write-FixtureFile $root 'popup/popup.html' '<link href="popup.css"><img src="../icons/icon.png"><script src="popup.js"></script>'
    Write-FixtureFile $root 'popup/popup.css' '@font-face { font-family: test; src: url("../fonts/main.woff2"); }'
    Write-FixtureFile $root 'popup/popup.js' '// popup'
    Write-FixtureFile $root 'fonts/main.woff2' 'fixture font'
    Write-FixtureFile $root 'icons/icon.png' 'fixture icon'
    Write-FixtureFile $root 'LICENSE' 'MIT fixture'
    Write-FixtureFile $root 'node_modules/unrelated/index.js' '// do not install'
    Write-FixtureFile $root '.git/HEAD' 'ref: refs/heads/main'
    return $root
}
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Test-Case([string]$Name, [scriptblock]$Body) {
    & $Body
    $global:rastinInstallerTest_testCount++
    Write-Host "PASS $Name"
}
function Assert-Fails([scriptblock]$Body, [string]$MessagePattern) {
    $failed = $false
    try { & $Body } catch {
        $failed = $true
        if ($_.Exception.Message -notmatch $MessagePattern) { throw "Unexpected error: $($_.Exception.Message)" }
    }
    Assert $failed 'Expected an installation failure.'
}
function Assert-Preserved([string]$Destination, [string]$Version) {
    $manifest = Get-Content -LiteralPath (Join-Path $Destination 'manifest.json') -Raw | ConvertFrom-Json
    Assert ($manifest.version -eq $Version) 'The existing installation was changed after failure.'
}
function New-UnsafeZip([string]$Name, [string[]]$Entries, [int]$Attributes = 0) {
    $zipPath = Join-Path $testRoot ($Name + '.zip')
    $archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries) {
            $entry = $archive.CreateEntry($name)
            if ($Attributes) { $entry.ExternalAttributes = $Attributes }
            $writer = New-Object IO.StreamWriter ($entry.Open())
            try { $writer.Write('fixture') } finally { $writer.Dispose() }
        }
    } finally { $archive.Dispose() }
    return $zipPath
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $source = New-Fixture "source space and apostrophe's"
    $destination = Join-Path $testRoot "installed space and apostrophe's"
    Test-Case 'Fresh local install; allowlist and marker; spaces/apostrophes' {
        & $installer -Source $source -Destination $destination -NoOpen
        $marker = Get-Content -LiteralPath (Join-Path $destination '.rastin-install.json') -Raw | ConvertFrom-Json
        Assert ($marker.product -eq 'Rastin-RTL' -and $marker.format -eq 1) 'Installation marker is wrong.'
        Assert (-not (Test-Path -LiteralPath (Join-Path $destination 'node_modules'))) 'Development dependencies were installed.'
        Assert (-not (Test-Path -LiteralPath (Join-Path $destination '.git'))) 'Git metadata was installed.'
        Assert (Test-Path -LiteralPath (Join-Path $source '.git/HEAD')) 'Source was changed.'
    }
    $updated = New-Fixture 'updated' '1.1.0'
    Test-Case 'Managed update removes stale files' {
        Write-FixtureFile $destination 'content/stale.js' '// old'
        & $installer -Source $updated -Destination $destination -Browser edge -NoOpen
        Assert-Preserved $destination '1.1.0'
        Assert (-not (Test-Path -LiteralPath (Join-Path $destination 'content/stale.js'))) 'Stale runtime was retained.'
    }
    $missing = New-Fixture 'missing font' '2.0.0'
    Remove-Item -LiteralPath (Join-Path $missing 'fonts/main.woff2')
    Test-Case 'Missing font preserves previous version' {
        Assert-Fails { & $installer -Source $missing -Destination $destination -NoOpen } 'missing|empty'
        Assert-Preserved $destination '1.1.0'
    }
    $missingScript = New-Fixture 'missing content script' '2.0.0'
    Remove-Item -LiteralPath (Join-Path $missingScript 'content/main.js')
    Test-Case 'Missing manifest asset preserves previous version' {
        Assert-Fails { & $installer -Source $missingScript -Destination $destination -NoOpen } 'missing|empty'
        Assert-Preserved $destination '1.1.0'
    }
    Test-Case 'Publication failure rolls back previous version' {
        $global:rastinInstallerTest_publishFailure = $true
        $global:rastinInstallerTest_publishFailureTarget = $destination
        Assert-Fails { & $installer -Source $source -Destination $destination -NoOpen } 'Simulated failure'
        Assert-Preserved $destination '1.1.0'
    }
    Test-Case 'Relative source resolves against the current PowerShell location' {
        $previousLocation = Get-Location
        try {
            Set-Location -LiteralPath $source
            & $installer -Source . -Destination (Join-Path $testRoot 'relative install') -NoOpen
        } finally { Set-Location -LiteralPath $previousLocation.Path }
    }
    foreach ($invalidVersion in @('01.0', '0.0.0', '65536', '1.2.3.4.5')) {
        $badVersionSource = New-Fixture ('bad version ' + $invalidVersion) $invalidVersion
        Test-Case ('Refuse invalid Chrome version ' + $invalidVersion) {
            Assert-Fails { & $installer -Source $badVersionSource -Destination $destination -NoOpen } 'Invalid Chrome'
            Assert-Preserved $destination '1.1.0'
        }
    }
    foreach ($broken in @(
        @{Name = 'malformed rules JSON'; Path = 'ruleset_adblock.json'; Text = 'not json'; Pattern = 'Invalid runtime JSON'},
        @{Name = 'malformed cosmetic JSON'; Path = 'cosmetic_rules.json'; Text = '{'; Pattern = 'Invalid runtime JSON'},
        @{Name = 'missing importScripts dependency'; Path = 'background.js'; Text = 'importScripts("content/missing.js");'; Pattern = 'missing|empty'},
        @{Name = 'missing getURL dependency'; Path = 'content/main.js'; Text = 'chrome.runtime.getURL("icons/missing.png");'; Pattern = 'missing|empty'},
        @{Name = 'missing quoted CSS import'; Path = 'popup/popup.css'; Text = '@import "missing.css";'; Pattern = 'missing|empty'}
    )) {
        $brokenSource = New-Fixture $broken.Name '2.0.0'
        Write-FixtureFile $brokenSource $broken.Path $broken.Text
        Test-Case $broken.Name {
            Assert-Fails { & $installer -Source $brokenSource -Destination $destination -NoOpen } $broken.Pattern
            Assert-Preserved $destination '1.1.0'
        }
    }
    $unmanaged = New-Fixture 'unmanaged custom destination'
    Test-Case 'Custom unmanaged directory is preserved and refused' {
        Assert-Fails { & $installer -Source $source -Destination $unmanaged -NoOpen } 'not managed'
        Assert-Preserved $unmanaged '1.0.0'
        Assert (Test-Path -LiteralPath (Join-Path $unmanaged '.git/HEAD')) 'Unmanaged Git metadata was changed.'
    }
    Test-Case 'Filesystem roots and source/destination overlap are refused' {
        Assert-Fails { & $installer -Source $source -Destination ([IO.Path]::GetPathRoot($source)) -NoOpen } 'filesystem root'
        Assert-Fails { & $installer -Source $source -Destination (Join-Path $source 'inside') -NoOpen } 'overlap'
    }
    $legacy = Join-Path $env:LOCALAPPDATA 'Rastin-RTL'
    Copy-Item -LiteralPath $source -Destination $legacy -Recurse
    Test-Case 'Valid legacy default install preserves its full backup including Git' {
        & $installer -Source $updated -NoOpen
        Assert-Preserved $legacy '1.1.0'
        $backups = @(Get-ChildItem -LiteralPath $env:LOCALAPPDATA -Directory -Force | Where-Object Name -like '.rastin-backup-*')
        Assert ($backups.Count -eq 1) 'Legacy backup was not preserved.'
        Assert (Test-Path -LiteralPath (Join-Path $backups[0].FullName '.git/HEAD')) 'Legacy Git backup was lost.'
    }
    $archiveSource = New-Fixture 'Rastin-RTL-main' '1.2.0'
    $validZip = Join-Path $testRoot 'valid-remote.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($archiveSource, $validZip, [IO.Compression.CompressionLevel]::Optimal, $true)
    $remoteDestination = Join-Path $testRoot 'remote installation'
    Test-Case 'Downloaded-script invocation installs from validated remote archive' {
        $global:rastinInstallerTest_downloadFixtureZip = $validZip
        & $installerBlock -Destination $remoteDestination -NoOpen
        Assert-Preserved $remoteDestination '1.2.0'
    }
    Test-Case 'HTTP failure preserves existing runtime' {
        $global:rastinInstallerTest_mockStatus = 503
        Assert-Fails { & $installerBlock -Destination $remoteDestination -NoOpen } 'HTTP 200'
        Assert-Preserved $remoteDestination '1.2.0'
        $global:rastinInstallerTest_mockStatus = 200
    }
    $invalidZip = Join-Path $testRoot 'invalid.zip'
    [IO.File]::WriteAllText($invalidZip, 'not a zip')
    Test-Case 'Malformed download preserves existing runtime' {
        $global:rastinInstallerTest_downloadFixtureZip = $invalidZip
        Assert-Fails { & $installerBlock -Destination $remoteDestination -NoOpen } 'archive|directory|signature'
        Assert-Preserved $remoteDestination '1.2.0'
    }
    foreach ($scenario in @(
        @{Name = 'Traversal ZIP'; Entries = @('Rastin-RTL-main/../escaped.txt')},
        @{Name = 'Absolute ZIP'; Entries = @('/Rastin-RTL-main/file.txt')},
        @{Name = 'Duplicate ZIP'; Entries = @('Rastin-RTL-main/file.txt', 'Rastin-RTL-main/FILE.txt')},
        @{Name = 'Symlink ZIP'; Entries = @('Rastin-RTL-main/link'); Attributes = -1610612736}
    )) {
        $global:rastinInstallerTest_downloadFixtureZip = New-UnsafeZip $scenario.Name $scenario.Entries ([int]$scenario.Attributes)
        Test-Case $scenario.Name {
            Assert-Fails { & $installerBlock -Destination $remoteDestination -NoOpen } 'Unsafe|Duplicate|links'
            Assert-Preserved $remoteDestination '1.2.0'
        }
    }
    Test-Case '-NoOpen suppresses browser, Explorer and clipboard operations' {
        Assert ($global:rastinInstallerTest_interactiveCalls -eq 0) 'An interactive helper ran under -NoOpen.'
        Assert (@(Get-ChildItem -LiteralPath $env:TEMP -Force).Count -eq 0) 'Download directories were left behind.'
        Assert (@(Get-ChildItem -LiteralPath $testRoot -Directory -Force | Where-Object Name -like '.rastin-stage-*').Count -eq 0) 'Staging directories were left behind.'
    }
    Write-Host "$global:rastinInstallerTest_testCount installer tests passed on PowerShell $($PSVersionTable.PSVersion)."
} finally {
    $env:LOCALAPPDATA = $oldLocalAppData
    $env:TEMP = $oldTemporary
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    if ([IO.Path]::GetDirectoryName($resolvedRoot) -ne $repo -or [IO.Path]::GetFileName($resolvedRoot) -notlike '.installer-tests-*') { throw 'Refusing unsafe test cleanup.' }
    if (Test-Path -LiteralPath $resolvedRoot) {
        foreach ($item in @(Get-ChildItem -LiteralPath $resolvedRoot -Recurse -Force)) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing to recursively remove a test tree with links.' }
        }
        Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    }
}
