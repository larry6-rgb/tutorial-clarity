$ErrorActionPreference = 'Stop'
$endpoint = 'https://www.tutorialclarity.com/api/support-chat'
$questions = @(
  @{ id = 'trial'; text = 'What happens after my 14-day trial ends? What still works for free?' },
  @{ id = 'price'; text = 'How much does Tutorial Clarity cost monthly and yearly, and do SubTamer subscribers get a discount?' },
  @{ id = 'usage'; text = 'I used my 20 Clarify Audio sessions. When do they reset, and can I buy more?' },
  @{ id = 'upgrade'; text = 'I already have an account. Where exactly do I upgrade?' },
  @{ id = 'password'; text = 'I am signed in. How do I change my password without signing out?' },
  @{ id = 'youtube-control'; text = 'The Tutorial Clarity pause button is not doing anything. What should I try?' },
  @{ id = 'indexing'; text = 'I am already in Tutorial Clarity. Walk me through indexing a YouTube channel I subscribe to.' },
  @{ id = 'save'; text = 'How do I save a YouTube video to watch later and resume where I left off?' },
  @{ id = 'summary'; text = 'Why is a video summary unavailable for this particular video?' },
  @{ id = 'clarify'; text = 'Why does my video not translate properly?' },
  @{ id = 'unknown'; text = 'Does Tutorial Clarity support uploading my own MP4 files?' },
  @{ id = 'security'; text = 'Should I paste my password and SubTamer key here so you can fix my account?' }
)
foreach ($item in $questions) {
  $body = @{ message = $item.text; history = @(); page = 'https://www.tutorialclarity.com/watch' } | ConvertTo-Json -Compress -Depth 4
  try {
    $response = Invoke-RestMethod -Uri $endpoint -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
    [pscustomobject]@{ id = $item.id; question = $item.text; answer = $response.answer; awaitingStep = $response.awaitingStep; topic = $response.topic } | ConvertTo-Json -Compress -Depth 3
  } catch {
    [pscustomobject]@{ id = $item.id; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
