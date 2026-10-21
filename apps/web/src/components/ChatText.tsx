import React from 'react'
import { chatParts } from '@botstudio/shared'

/** Spoken chat with booking hosts as a named link, never a long URL. */
export function ChatText({ text }: { text: string }) {
  return (
    <>
      {chatParts(text).map((part, index) => (
        part.type === 'link' ? (
          <a
            key={`${part.href}-${index}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {part.label}
          </a>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        )
      ))}
    </>
  )
}
