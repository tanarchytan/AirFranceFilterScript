import { Coins, ExternalLink, LogIn } from 'lucide-react'
import { useState } from 'react'

interface AuthPromptProps {
  visible: boolean
  onConfirmed: () => void
}

export function AuthPrompt({ visible, onConfirmed }: AuthPromptProps) {
  const [opening, setOpening] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState(
    'Log in in Chrome, then click “I’m logged in” to capture the session.',
  )

  if (!visible) return null

  const openLogin = async () => {
    setOpening(true)
    setMessage('Opening Chrome on the Flying Blue page…')
    try {
      const response = await fetch('/api/auth/open', { method: 'POST' })
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string }
      setMessage(response.ok
        ? (payload.message ?? 'Chrome is open. Log in, then confirm here.')
        : (payload.error ?? 'Could not open Chrome.'))
    } catch {
      setMessage('Could not open the Air France login window.')
    } finally {
      setOpening(false)
    }
  }

  const confirmSignIn = async () => {
    setConfirming(true)
    setMessage('Fetching Flying Blue cookies…')
    try {
      const response = await fetch('/api/auth/confirm', { method: 'POST' })
      const payload = await response.json() as {
        ok?: boolean
        authenticated?: boolean
        cookieCount?: number
        message?: string
        error?: string
      }
      if (response.ok && payload.authenticated) {
        setMessage(payload.message ?? 'Flying Blue session ready.')
        onConfirmed()
        return
      }
      setMessage(payload.error ?? 'Still logged out. Finish logging in in Chrome.')
    } catch {
      setMessage('Could not confirm. Try again after logging in.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section className="auth-prompt" aria-label="Flying Blue login">
      <div className="auth-prompt-copy">
        <Coins size={18} />
        <div>
          <strong>Flying Blue login</strong>
          <span>{message}</span>
        </div>
      </div>
      <div className="auth-prompt-actions">
        <button type="button" onClick={() => void openLogin()} disabled={opening || confirming}>
          <ExternalLink size={14} /> {opening ? 'Opening…' : 'Open Chrome'}
        </button>
        <button type="button" className="primary" onClick={() => void confirmSignIn()} disabled={confirming || opening}>
          <LogIn size={14} /> {confirming ? 'Fetching…' : "I'm logged in"}
        </button>
      </div>
    </section>
  )
}
