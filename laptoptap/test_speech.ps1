Add-Type -AssemblyName System.Speech

try {
    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $engine.SetInputToDefaultAudioDevice()
    
    $choices = New-Object System.Speech.Recognition.Choices
    [string[]]$words = @("copy", "paste", "screenshot", "lock", "play", "pause")
    $choices.Add($words)
    
    $gb = New-Object System.Speech.Recognition.GrammarBuilder($choices)
    $grammar = New-Object System.Speech.Recognition.Grammar($gb)
    $engine.LoadGrammar($grammar)
    
    Write-Host "SUCCESS: System.Speech.Recognition engine loaded and ready!"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
