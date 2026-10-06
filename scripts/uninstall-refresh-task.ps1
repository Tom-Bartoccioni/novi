<#
.SYNOPSIS
  Supprime la tâche planifiée « Novi refresh ».
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'Novi refresh'
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tâche « $TaskName » supprimée."
} else {
  Write-Host "Aucune tâche « $TaskName » à supprimer."
}
