import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { flowCatalog, guidedFlowGraph } from '@botstudio/shared'
import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@botstudio/ui'
import { apiFetch } from '../../lib/api'
import type { FlowGraph } from '../../lib/api'

type Step = 'pick' | 'details'

interface FlowWizardProps {
  open: boolean
  existingNames: string[]
  pending: boolean
  error: string
  onClose: () => void
  onCreate: (input: { name: string; description: string; tags: string[]; graph: FlowGraph }) => void
}

function TemplateButton({ template, onPick }: { template: { name: string; description: string }; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(template.name)}
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-left hover:bg-[var(--bg-hover)]"
    >
      <p className="text-sm font-medium text-[var(--text-primary)]">{template.name}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{template.description}</p>
    </button>
  )
}

function freshName(base: string, existing: string[]) {
  if (!existing.includes(base)) return base
  let n = 2
  while (existing.includes(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

export function FlowWizard({ open, existingNames, pending, error, onClose, onCreate }: FlowWizardProps) {
  const { data: tenant } = useQuery({
    queryKey: ['tenant-me'],
    enabled: open,
    retry: false,
    queryFn: () => apiFetch<{ data: { name?: string } | null }>('/tenants/me').then((res) => res.data),
  })
  const company = tenant?.name?.trim() || 'your company'
  const templates = flowCatalog(company)
  const corporate = templates.filter((template) => template.tags.includes('corporate') && template.name !== 'Welcome & Routing')
  const salon = templates.filter((template) => template.tags.includes('salon'))
  const welcome = templates.find((template) => template.name === 'Welcome & Routing')
  const others = templates.filter((template) => !template.tags.includes('corporate') && !template.tags.includes('salon'))
  const [step, setStep] = useState<Step>('pick')
  const [choice, setChoice] = useState<string>('guided')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [greeting, setGreeting] = useState("Hi, I'm the assistant.")
  const [greetingEdited, setGreetingEdited] = useState(false)
  const [question, setQuestion] = useState("What's your name?")
  const [handoff, setHandoff] = useState(false)

  useEffect(() => {
    if (!open || greetingEdited || company === 'your company') return
    setGreeting(`Hi, I'm the assistant from ${company}.`)
  }, [open, company, greetingEdited])

  function reset() {
    setStep('pick')
    setChoice('guided')
    setName('')
    setDescription('')
    setGreeting(company === 'your company' ? "Hi, I'm the assistant." : `Hi, I'm the assistant from ${company}.`)
    setGreetingEdited(false)
    setQuestion("What's your name?")
    setHandoff(false)
  }

  function close() {
    reset()
    onClose()
  }

  function pick(id: string) {
    setChoice(id)
    if (id === 'guided') {
      setName(freshName('New flow', existingNames))
      setDescription('Built from a few answers')
    } else {
      const template = templates.find((item) => item.name === id)
      setName(freshName(template?.name ?? 'New flow', existingNames))
      setDescription(template?.description ?? '')
    }
    setStep('details')
  }

  function create() {
    if (!name.trim()) return
    if (choice === 'guided') {
      onCreate({
        name: name.trim(),
        description: description.trim(),
        tags: ['guided'],
        graph: guidedFlowGraph({ greeting, question, handoff }) as FlowGraph,
      })
      return
    }
    const template = templates.find((item) => item.name === choice)
    if (!template) return
    onCreate({
      name: name.trim(),
      description: description.trim() || template.description,
      tags: template.tags,
      graph: template.graph as FlowGraph,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{step === 'pick' ? 'New flow' : choice === 'guided' ? 'Guide a new flow' : 'Start from a template'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {step === 'pick' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => pick('guided')}
                  className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent-muted)] p-3 text-left"
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">Guided</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Answer a few questions and we draw the steps.</p>
                </button>
                {welcome && (
                  <TemplateButton template={welcome} onPick={pick} />
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">Corporate services</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {corporate.map((template) => (
                    <TemplateButton key={template.name} template={template} onPick={pick} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">Hair studio</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {salon.map((template) => (
                    <TemplateButton key={template.name} template={template} onPick={pick} />
                  ))}
                </div>
              </div>
              {others.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">More templates</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {others.map((template) => (
                      <TemplateButton key={template.name} template={template} onPick={pick} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Name</span>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Description</span>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              {choice === 'guided' && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Opening line</span>
                    <Input value={greeting} onChange={(e) => { setGreetingEdited(true); setGreeting(e.target.value) }} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-[var(--text-muted)]">Question for the visitor</span>
                    <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Leave blank to skip the question" />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <input type="checkbox" checked={handoff} onChange={(e) => setHandoff(e.target.checked)} />
                    Hand the chat to the team after that
                  </label>
                </>
              )}
              {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {step === 'details' ? (
            <Button variant="ghost" onClick={() => setStep('pick')}>Back</Button>
          ) : (
            <Button variant="ghost" onClick={close}>Cancel</Button>
          )}
          {step === 'details' && (
            <Button disabled={!name.trim() || pending} onClick={create}>
              {pending ? 'Creating…' : 'Create flow'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
