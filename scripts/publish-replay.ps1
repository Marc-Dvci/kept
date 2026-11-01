$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publishRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot '.local\pages'))
if (-not $publishRoot.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid publication target' }
Set-Location -LiteralPath $repoRoot
$visibility = gh repo view Marc-Dvci/kept --json visibility --jq .visibility
if ($LASTEXITCODE -ne 0 -or $visibility -ne 'PUBLIC') { throw 'Publish only from a public repository' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
New-Item -ItemType Directory -Path $publishRoot -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'static\app') -Force | Copy-Item -Destination $publishRoot -Recurse -Force
[IO.File]::WriteAllText((Join-Path $publishRoot '.nojekyll'), '')
if (-not (Test-Path -LiteralPath (Join-Path $publishRoot '.git'))) {
    git -C $publishRoot init --initial-branch gh-pages --quiet
    git -C $publishRoot config user.name 'Marc Donovici'
    git -C $publishRoot config user.email 'azerty10997@gmail.com'
    git -C $publishRoot remote add origin https://github.com/Marc-Dvci/kept.git
}
git -C $publishRoot add .
git -C $publishRoot diff --cached --quiet
if ($LASTEXITCODE -eq 1) {
    git -C $publishRoot commit --quiet -m 'Publish the synthetic promise replay'
    if ($LASTEXITCODE -ne 0) { throw 'Replay commit failed' }
}
git -C $publishRoot push --set-upstream origin gh-pages
if ($LASTEXITCODE -ne 0) { throw 'Publication push failed' }
