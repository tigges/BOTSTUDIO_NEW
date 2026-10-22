import React, { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bot, Eye, EyeOff } from 'lucide-react'
import { Button, Input, Card } from '@botstudio/ui'
import { auth } from '../lib/api'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token') ?? '')
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (!token) { setError('Missing or invalid reset token'); return }
    setLoading(true)
    try {
      await auth.resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate({ to: '/sign-in' }), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset link is invalid or expired')
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
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Set new password</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">Choose a password with at least 8 characters</p>
          </div>
        </div>

        <Card>
          {done ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">✅</div>
              <p className="text-sm text-[var(--text-primary)] font-medium">Password updated</p>
              <p className="text-sm text-[var(--text-muted)]">Redirecting you to sign in…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="New password"
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                rightIcon={
                  <button type="button" onClick={() => setShowPw((v) => !v)}>
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
                required
              />
              <Input
                label="Confirm new password"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && (
                <p className="text-xs text-[var(--error)] rounded bg-[var(--error-muted)] px-3 py-2">{error}</p>
              )}
              <Button type="submit" disabled={loading || !token} className="w-full mt-1">
                {loading ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
