<#
.SYNOPSIS
  Enregistre une tâche planifiée Windows « Novi refresh » qui lance `pnpm pipeline refresh` à intervalle régulier.
.PARAMETER IntervalHours
  Intervalle entre deux exécutions (défaut 6).
.PARAMETER Departement
  Département passé au pipeline (défaut 06).
.EXAMPLE
  pwsh scripts/install-refresh-task.ps1 -IntervalHours 4
#>
param(
  [int]$IntervalHours = 6,
  [string]$Departement = '06'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Novi refresh'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LogDir = Join-Path $RepoRoot 'data\logs'
$LogFile = Join-Path $LogDir 'refresh.log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$pnpm = (Get-Command pnpm -ErrorAction Stop).Source
$pwsh = (Get-Command pwsh -ErrorAction Stop).Source

# Le journal est tronqué aux 500 dernières lignes quand il dépasse 1 Mo, puis la commande y ajoute sa sortie.
$Inner = @"
Set-Location '$RepoRoot'
if ((Test-Path '$LogFile') -and ((Get-Item '$LogFile').Length -gt 1MB)) {
  (Get-Content '$LogFile' -Tail 500) | Set-Content '$LogFile'
}
"=== refresh `$(Get-Date -Format s)" | Add-Content '$LogFile'
& '$pnpm' pipeline refresh -d $Departement *>> '$LogFile'
"@
$Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Inner))

$Action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $Encoded" -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours $IntervalHours)
# Sur portable : le refresh est léger (quelques requêtes HTTP), on l'autorise donc sur batterie.
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Novi : rafraîchissement des offres France Travail toutes les $IntervalHours h" -Force | Out-Null

$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Tâche « $TaskName » enregistrée : toutes les $IntervalHours h, journal dans $LogFile"
Write-Host "Prochaine exécution : $($Info.NextRunTime)"
