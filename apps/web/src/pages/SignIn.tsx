import React, { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { Bot, Eye, EyeOff, FlaskConical } from 'lucide-react'
import { Button, Input, Card } from '@botstudio/ui'
import { useAppStore } from '../store/app'
import { apiFetch } from '../lib/api'

const isDemoMode = () => import.meta.env.VITE_DEMO_MODE === 'true'

const DEMO_USER = {
  id: 'demo-user',
  email: 'charles@acme.com',
  displayName: 'Charles',
  tenantId: 'demo-tenant',
  role: 'ADMIN',
}

const DEMO_BOT = {
  id: 'demo-bot',
  name: 'Support Bot',
  description: 'Handles customer support enquiries',
  status: 'active',
  environments: [
    { id: 'demo-env-sandbox', kind: 'sandbox', name: 'Sandbox' },
    { id: 'demo-env-prod', kind: 'production', name: 'Production' },
  ],
}

type Mode = 'login' | 'register'

export function SignInPage() {
  const navigate = useNavigate()
  const { setAuth, setBots } = useAppStore()
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).get('mode') === 'register' ? 'register' : 'login',
  )
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const demo = isDemoMode()

  const [form, setForm] = useState({
    email: demo ? 'charles@acme.com' : '',
    password: demo ? 'password123' : '',
    displayName: '',
    tenantName: '',
    tenantSlug: '',
  })

  function update(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    if (field === 'tenantName' && mode === 'register') {
      setForm((f) => ({
        ...f,
        [field]: value,
        tenantSlug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      }))
    }
    setError(null)
  }

  function enterDemo() {
    setAuth(DEMO_USER, 'demo-token')
    setBots([DEMO_BOT])
    navigate({ to: '/overview' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // In demo mode bypass the backend entirely
    if (demo) {
      enterDemo()
      return
    }

    setLoading(true)
    setError(null)

    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : form

      const res = await apiFetch<{ data: { token: string; user: Parameters<typeof setAuth>[0] } }>(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) }
      )

      setAuth(res.data.user, res.data.token)

      const botsRes = await apiFetch<{ data: Parameters<typeof setBots>[0] }>('/bots')
      setBots(botsRes.data)

      navigate({ to: '/overview' })
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message)
      else setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-base)] p-4">
      <div className="w-full max-w-[400px]">
        {/* Demo mode banner */}
        {demo && (
          <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent-muted,color-mix(in_srgb,var(--accent)_12%,transparent))] px-3 py-2 text-sm text-[var(--accent)]">
            <FlaskConical size={14} className="shrink-0" />
            <span>
              <strong>Demo mode</strong> — credentials are pre-filled.
              All data is sample data; nothing is saved.
            </span>
          </div>
        )}

        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent)]">
            <Bot size={24} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">BotStudio</h1>
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {mode === 'login' ? 'Sign in to your workspace' : 'Create your workspace'}
            </p>
          </div>
        </div>

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && !demo && (
              <>
                <Input
                  label="Your name"
                  placeholder="Charles"
                  value={form.displayName}
                  onChange={(e) => update('displayName', e.target.value)}
                  required
                />
                <Input
                  label="Workspace name"
                  placeholder="Acme Corp"
                  value={form.tenantName}
                  onChange={(e) => update('tenantName', e.target.value)}
                  required
                />
                <Input
                  label="Workspace URL"
                  placeholder="acme-corp"
                  value={form.tenantSlug}
                  onChange={(e) => update('tenantSlug', e.target.value)}
                  hint="Letters, numbers, and hyphens"
                  required
                />
              </>
            )}

            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              required
            />

            <Input
              label="Password"
              type={showPw ? 'text' : 'password'}
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              rightIcon={
                <button type="button" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
              required
            />
            {mode === 'login' && !demo && (
              <div className="text-right -mt-1">
                <Link to="/forgot-password" className="text-xs text-[var(--text-link)] hover:underline">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && (
              <p className="text-xs text-[var(--error)] rounded bg-[var(--error-muted)] px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" disabled={loading} className="w-full mt-1">
              {loading
                ? 'Please wait…'
                : demo
                ? 'Enter demo'
                : mode === 'login'
                ? 'Sign in'
                : 'Create workspace'}
            </Button>
          </form>

          {!demo && (
            <div className="mt-4 text-center text-sm text-[var(--text-muted)]">
              {mode === 'login' ? (
                <>
                  No account?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className="text-[var(--text-link)] hover:underline"
                  >
                    Create workspace
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="text-[var(--text-link)] hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
          BotStudio
        </p>
      </div>
    </div>
  )
}
