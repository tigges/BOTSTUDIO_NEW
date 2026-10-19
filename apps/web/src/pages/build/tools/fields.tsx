import React from 'react'
import { cn } from '@ybot/ui'

export const fieldClass =
  'w-full rounded border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none'

export function Field({ label, hint, error, htmlFor, children }: { label: string; hint?: React.ReactNode; error?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
      {children}
      {error ? <p className="text-[11px] text-[var(--error)]">{error}</p> : hint ? <p className="text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  )
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, 'resize-y', className)} />
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(fieldClass, className)} />
}

export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, className)} />
}

export function Callout({ tone = 'muted', children }: { tone?: 'muted' | 'warning' | 'error' | 'success'; children: React.ReactNode }) {
  const styles = {
    muted: 'border-[var(--border)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]',
    warning: 'border-[var(--warning)]/30 bg-[var(--warning-muted)] text-[var(--text-primary)]',
    error: 'border-[var(--error)]/30 bg-[var(--error-muted)] text-[var(--text-primary)]',
    success: 'border-[var(--success)]/30 bg-[var(--success-muted)] text-[var(--text-primary)]',
  }[tone]
  return <div className={cn('rounded border px-3 py-2 text-[11px] leading-relaxed', styles)}>{children}</div>
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-overlay)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}
