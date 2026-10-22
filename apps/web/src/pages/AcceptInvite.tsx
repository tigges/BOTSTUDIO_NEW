import React, { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bot, Eye, EyeOff } from 'lucide-react'
import { Button, Input, Card } from '@botstudio/ui'
import { auth } from '../lib/api'
import { useAppStore } from '../store/app'

export function AcceptInvitePage() {
  const navigate = useNavigate()
  const { setAuth, setBots } = useAppStore()
  const [token, setToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenMissing, setTokenMissing] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const t = params.get('token') ?? ''
    setToken(t)
    if (!t) setTokenMissing(true)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const res = await auth.acceptInvite(token, password, displayName || undefined)
      setAuth(res.data.user as Parameters<typeof setAuth>[0], res.data.token)
      const { bots: botsApi } = await import('../lib/api')
      const botsRes = await botsApi.list()
      setBots(botsRes.data)
      navigate({ to: '/overview' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invite link is invalid or has expired')
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
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Accept your invite</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">Set a password to activate your account</p>
          </div>
        </div>

        <Card>
          {tokenMissing ? (
            <div className="text-center space-y-3">
              <div className="text-3xl">🔗</div>
              <p className="text-sm text-[var(--text-primary)] font-medium">Invalid invite link</p>
              <p className="text-sm text-[var(--text-muted)]">This link is missing or malformed. Ask your admin to resend the invite.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Your name"
                placeholder="Jane Smith"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                hint="Optional — you can update this later"
              />
              <Input
                label="Password"
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
                label="Confirm password"
                type="password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && (
                <p className="text-xs text-[var(--error)] rounded bg-[var(--error-muted)] px-3 py-2">{error}</p>
              )}
              <Button type="submit" disabled={loading} className="w-full mt-1">
                {loading ? 'Activating…' : 'Activate account'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
