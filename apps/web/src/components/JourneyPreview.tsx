import React from 'react'

export interface JourneyPreviewDoor {
  title: string
  blurb: string
}

/** Welcome card plus Opens grid — the same shape as the journey map, for the start wizard. */
export function JourneyPreview({
  greeting,
  doors,
  empty,
  persona,
  avatarUrl,
}: {
  greeting: string
  doors: JourneyPreviewDoor[]
  empty?: string
  persona?: string
  avatarUrl?: string
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
        <div className="flex items-center gap-2">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full" /> : null}
          <p className="text-[11px] font-bold text-emerald-800">{persona ? `${persona} starts here` : 'Visitors start here'}</p>
        </div>
        <p className="mt-1 text-sm text-emerald-950">{greeting}</p>
      </div>
      {doors.length > 0 ? (
        <>
          <div className="flex justify-center">
            <span className="h-5 w-px bg-emerald-200" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">Opens</p>
          <div className="grid grid-cols-2 gap-2">
            {doors.map((door) => (
              <div key={door.title} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-2">
                <p className="text-xs font-semibold text-[var(--text-primary)]">{door.title}</p>
                <p className="mt-1 rounded-md border border-[var(--border)] bg-white px-1.5 py-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                  {door.blurb}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : (
        empty ? <p className="text-sm text-[var(--text-secondary)]">{empty}</p> : null
      )}
    </div>
  )
}

export function ClusterSketch({ accent = false }: { accent?: boolean }) {
  const stroke = accent ? '#059669' : 'var(--border)'
  const fill = accent ? '#ecfdf5' : 'var(--bg-base)'
  return (
    <svg viewBox="0 0 72 44" className="h-9 w-14" aria-hidden>
      <rect x="24" y="2" width="24" height="12" rx="3" fill={accent ? '#ecfdf5' : fill} stroke={stroke} />
      <line x1="36" y1="14" x2="36" y2="20" stroke={stroke} />
      <line x1="12" y1="20" x2="60" y2="20" stroke={stroke} />
      <rect x="2" y="20" width="20" height="20" rx="3" fill={fill} stroke={stroke} />
      <rect x="26" y="20" width="20" height="20" rx="3" fill={fill} stroke={stroke} />
      <rect x="50" y="20" width="20" height="20" rx="3" fill={fill} stroke={stroke} />
    </svg>
  )
}
