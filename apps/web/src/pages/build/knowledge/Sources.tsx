import React, { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  BookOpen, Plus, Globe, FileText, Link2, RefreshCw,
  CheckCircle, AlertCircle, Clock, Trash2, Loader2, Upload, Building2, HelpCircle,
} from 'lucide-react'
import { Button, Badge, EmptyState, Card } from '@botstudio/ui'
import { KnowledgeSubNav } from './subnav'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
  Input,
} from '@botstudio/ui'
import { cn } from '@botstudio/ui'
import { useSources, useCreateSource, useUploadSource, useSyncSource, useDeleteSource, useBusiness } from '../../../lib/hooks'

const BUSINESS_KIND = 'business'
const FAQ_KIND = 'faq'

/** Sources the console rebuilds from another editor; they cannot be synced or deleted here. */
const MANAGED: Record<string, { badge: string; note: string; to: '/build/business' | '/build/knowledge/faqs'; edit: string }> = {
  [BUSINESS_KIND]: {
    badge: 'Managed by Business details',
    note: 'One document per filled field, rebuilt every time Business details are saved. When another source disagrees, answers use these.',
    to: '/build/business',
    edit: 'Edit in Business details',
  },
  [FAQ_KIND]: {
    badge: 'Managed by FAQs',
    note: 'One document per question and answer, rebuilt every time an FAQ is saved. Answers cite them like any other source.',
    to: '/build/knowledge/faqs',
    edit: 'Edit FAQs',
  },
}


const KIND_ICON: Record<string, React.ElementType> = {
  website: Globe,
  url: Link2,
  file: FileText,
  [BUSINESS_KIND]: Building2,
  [FAQ_KIND]: HelpCircle,
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error'> = {
  indexed: 'success',
  processing: 'warning',
  failed: 'error',
}

const STATUS_ICON: Record<string, React.ElementType> = {
  indexed: CheckCircle,
  processing: Clock,
  failed: AlertCircle,
}

const ACCEPTED = '.pdf,.doc,.docx,.txt,.md,.csv'

export function SourcesPage() {
  const { data: sources = [], isLoading } = useSources()
  const createSource = useCreateSource()
  const uploadSource = useUploadSource()
  const syncSource = useSyncSource()
  const deleteSource = useDeleteSource()
  const { data: businessView } = useBusiness()
  const conflictsBySource = new Map<string, number>()
  for (const conflict of businessView?.conflicts ?? []) conflictsBySource.set(conflict.source, (conflictsBySource.get(conflict.source) ?? 0) + 1)

  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'website' | 'url' | 'file' | 'faq'>('url')
  const [addError, setAddError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(file: File) {
    setUploadFile(file)
    // Pre-fill name from filename
    setNewName((prev) => prev || file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }

  async function addSource() {
    if (!newName.trim()) return
    setAddError('')
    try {
      if (newKind === 'file') {
        if (!uploadFile) {
          setAddError('Please select a file to upload')
          return
        }
        await uploadSource.mutateAsync(uploadFile)
      } else {
        await createSource.mutateAsync({
          name: newName.trim(),
          kind: newKind,
          config: { url: newUrl.trim() },
        })
      }
      setShowAdd(false)
      setNewUrl('')
      setNewName('')
      setUploadFile(null)
      setAddError('')
    } catch (e) { setAddError(e instanceof Error ? e.message : 'Failed to add source') }
  }

  const isPending = createSource.isPending || uploadSource.isPending

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between px-6 pt-4 pb-0">
          <h1 className="text-base font-semibold text-[var(--text-primary)]">Knowledge</h1>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={13} /> Add Source
          </Button>
        </div>
        <KnowledgeSubNav />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <p className="text-xs text-[var(--text-muted)]">Total Sources</p>
            <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{sources.length}</p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--text-muted)]">Total Docs</p>
            <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
              {sources.reduce((sum, s) => sum + (s.documents?.length ?? 0), 0)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-[var(--text-muted)]">Indexed</p>
            <p className="text-2xl font-bold text-[var(--success)] mt-1">
              {sources.filter((s) => s.lastSyncAt).length}
            </p>
          </Card>
        </div>

        {/* Sources list */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        )}
        {!isLoading && sources.length === 0 && (
          <EmptyState
            icon={<BookOpen size={28} />}
            title="No knowledge sources yet"
            description="Add a website or URL, upload a document, or write FAQs. The bot answers from them and cites them."
            action={<Button size="sm" onClick={() => setShowAdd(true)}><Plus size={13} /> Add Source</Button>}
          />
        )}
        <div className="space-y-2">
          {sources.map((src) => {
            const KindIcon = (KIND_ICON[src.kind] ?? Globe) as React.ElementType
            const status = src.lastSyncAt ? 'indexed' : 'processing'
            const StatusIcon = (STATUS_ICON[status] ?? Clock) as React.ElementType
            const managed = MANAGED[src.kind]
            const conflicts = managed ? 0 : (conflictsBySource.get(src.name) ?? 0)
            return (
              <div
                key={src.id}
                className="flex items-center gap-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] p-4"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--bg-overlay)]">
                  <KindIcon size={16} className="text-[var(--text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-[var(--text-primary)] text-sm truncate">{src.name}</p>
                    <Badge variant={STATUS_VARIANT[status] ?? 'muted'} dot>{status}</Badge>
                    {managed && <Badge variant="muted">{managed.badge}</Badge>}
                    {conflicts > 0 && (
                      <Link to="/build/business" className="text-xs font-medium text-amber-700 hover:underline">
                        {conflicts} {conflicts === 1 ? 'passage disagrees' : 'passages disagree'} with Business details
                      </Link>
                    )}
                  </div>
                  {managed && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{managed.note}</p>}
                  <div className="flex items-center gap-3 mt-0.5">
                    {(src.config as { url?: string })?.url && (
                      <span className="text-xs text-[var(--text-muted)] truncate max-w-[200px]">
                        {String((src.config as { url?: string }).url)}
                      </span>
                    )}
                    {(src.config as { filename?: string })?.filename && (
                      <span className="text-xs text-[var(--text-muted)]">
                        {String((src.config as { filename?: string }).filename)}
                      </span>
                    )}
                    {(src.documents?.length ?? 0) > 0 && (
                      <span className="text-xs text-[var(--text-muted)]">{src.documents?.length ?? 0} docs</span>
                    )}
                    {src.lastSyncAt && (
                      <span className="text-xs text-[var(--text-muted)]">
                        Indexed {new Date(src.lastSyncAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                {managed ? (
                  <Link to={managed.to} className="shrink-0 text-xs font-medium text-[var(--accent)] hover:underline">
                    {managed.edit}
                  </Link>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => syncSource.mutate(src.id)}
                      title="Re-sync / Re-index"
                      disabled={syncSource.isPending}
                    >
                      <RefreshCw size={13} className={cn(syncSource.isPending && 'animate-spin')} />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => deleteSource.mutate(src.id)} title="Delete">
                      <Trash2 size={13} />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Add Source Dialog */}
      <Dialog open={showAdd} onOpenChange={(o) => { setShowAdd(o); if (!o) { setUploadFile(null); setNewName(''); setNewUrl(''); setAddError('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Knowledge Source</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)]">Source type</label>
                <div className="mt-1 flex gap-2">
                  {(['url', 'website', 'file', 'faq'] as const).map((k) => {
                    const Icon = KIND_ICON[k] ?? Globe
                    return (
                      <button
                        key={k}
                        onClick={() => { setNewKind(k); setUploadFile(null); setNewName(''); setAddError('') }}
                        className={cn(
                          'flex flex-1 flex-col items-center gap-1 rounded-[var(--radius)] border p-3 text-xs transition-colors',
                          newKind === k
                            ? 'border-[var(--accent)] bg-[var(--accent-muted)] text-[var(--accent)]'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                        )}
                      >
                        <Icon size={18} />
                        {k === 'faq' ? 'FAQs' : k.charAt(0).toUpperCase() + k.slice(1)}
                      </button>
                    )
                  })}
                </div>
              </div>

              {newKind === 'faq' && (
                <p className="text-sm text-[var(--text-secondary)]" data-testid="faq-source-note">
                  Write questions and answers in the FAQ editor. Each one becomes a document in the FAQs source, so Search & Test finds it and answers cite it.
                </p>
              )}

              {(newKind === 'url' || newKind === 'website') && (
                <Input label="Name" placeholder="Product Documentation" value={newName} onChange={(e) => setNewName(e.target.value)} />
              )}

              {(newKind === 'url' || newKind === 'website') && (
                <Input label="URL" placeholder="https://docs.example.com" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
              )}

              {newKind === 'file' && (
                <div>
                  <label className="text-xs font-medium text-[var(--text-secondary)] mb-1.5 block">Upload file</label>
                  {/* Hidden real file input */}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPTED}
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
                  />
                  <div
                    className={cn(
                      'flex flex-col items-center justify-center rounded border-2 border-dashed p-8 transition-colors cursor-pointer',
                      dragging
                        ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
                        : uploadFile
                          ? 'border-[var(--success)] bg-[var(--success)]/5'
                          : 'border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent-muted)]',
                    )}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                  >
                    {uploadFile ? (
                      <>
                        <FileText size={24} className="mx-auto mb-2 text-[var(--success)]" />
                        <p className="text-sm font-medium text-[var(--text-primary)]">{uploadFile.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{(uploadFile.size / 1024).toFixed(1)} KB · click to change</p>
                      </>
                    ) : (
                      <>
                        <Upload size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
                        <p className="text-sm text-[var(--text-muted)]">Drop PDF, DOCX, TXT, or CSV here</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">or click to browse</p>
                      </>
                    )}
                  </div>
                  {uploadFile && (
                    <div className="mt-2">
                      <Input
                        label="Source name (auto-filled)"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g. Product Manual"
                      />
                    </div>
                  )}
                </div>
              )}

              {addError && (
                <p className="text-xs text-[var(--error)] bg-[var(--error-muted)] rounded px-3 py-2">{addError}</p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            {newKind === 'faq' ? (
              <Link to="/build/knowledge/faqs" onClick={() => setShowAdd(false)}>
                <Button>Open the FAQ editor</Button>
              </Link>
            ) : (
              <Button
                onClick={addSource}
                disabled={(newKind === 'file' ? !uploadFile : !newName.trim()) || isPending}
              >
                {isPending ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
                {newKind === 'file' ? 'Upload & Index' : 'Add Source'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
