import React, { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bot } from 'lucide-react'
import { Button, Input, Card } from '@botstudio/ui'
import { auth } from '../lib/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await auth.forgotPassword(email)
      setSent(true)
    } catch {
      // Show success regardless to prevent email enumeration
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent)]">
            <Bot size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Forgot password?</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              Enter your email and we'll send a reset link
            </p>
          </div>
        </div>

        <Card>
          {sent ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">📬</div>
              <p className="text-sm text-[var(--text-primary)] font-medium">Check your inbox</p>
              <p className="text-sm text-[var(--text-muted)]">
                If <strong>{email}</strong> is registered, you'll receive a reset link within a minute.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <p className="text-xs text-[var(--error)] rounded bg-[var(--error-muted)] px-3 py-2">{error}</p>
              )}
              <Button type="submit" disabled={loading} className="w-full mt-1">
                {loading ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}
          <div className="mt-4 text-center text-sm text-[var(--text-muted)]">
            <Link to="/sign-in" className="text-[var(--text-link)] hover:underline">Back to sign in</Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
