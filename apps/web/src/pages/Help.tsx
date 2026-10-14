import React, { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { HELP_TOPICS } from './help-topics'

function shot(file: string) {
  const base = import.meta.env.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}help/${file}`
}

function Figure({ file, alt }: { file: string; alt: string }) {
  return (
    <img
      src={shot(file)}
      alt={alt}
      className="mt-3 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)]"
    />
  )
}

export function HelpPage() {
  const hash = useRouterState({ select: (state) => state.location.hash })

  useEffect(() => {
    const id = (hash || window.location.hash).replace(/^#/, '')
    const node = id ? document.getElementById(id) : null
    const scroller = node?.closest('main')
    if (!node || !(scroller instanceof HTMLElement)) return
    const go = () => {
      const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16
      scroller.scrollTo({ top })
    }
    go()
    const images = [...scroller.querySelectorAll('img')]
    for (const img of images) {
      if (!img.complete) img.addEventListener('load', go, { once: true })
    }
    return () => {
      for (const img of images) img.removeEventListener('load', go)
    }
  }, [hash])

  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8 p-6">
      <nav className="sticky top-6 hidden h-fit w-44 shrink-0 md:block">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Help</p>
        <div className="flex flex-col gap-1">
          {HELP_TOPICS.map((topic) => (
            <a
              key={topic.id}
              href={`#${topic.id}`}
              className="rounded px-2 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              {topic.label}
            </a>
          ))}
        </div>
      </nav>

      <article className="min-w-0 flex-1 space-y-10 pb-16">
        <header>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Help</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            The pictures are the same screens the live checks open: overview, flows, the canvas, the inbox, and integrations.
          </p>
        </header>

        <section id="start" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Getting started</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Sign in, pick a bot in the top bar, then choose Sandbox or Production. Sandbox is where you try a flow. Production is what the website widget uses after you publish. Acme and Bella are the demos you can click through. New records you create for practice belong in QA Lab. Manage bots, in that same menu, renames the bot in the top bar or deletes it. The name guests hear stays in Settings, under Bot Identity.
          </p>
          <Figure file="overview.jpg" alt="Overview dashboard" />
        </section>

        <section id="widget" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Widget to inbox</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            A visitor message on the website widget is answered by the published flow. A greeting uses the visitor's name when we know it. Otherwise it says hello neutrally and asks for their name. The chat never shows an empty name field. Working hours start the queue clock for people. They do not replace the bot. The same chat then shows in Inbox and on the overview.
          </p>
          <Figure file="widget.jpg" alt="Website widget on the Bella demo page" />
          <Figure file="inbox.jpg" alt="Inbox chats" />
        </section>

        <section id="flows" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Flows</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Open a flow from the list. The list and the canvas follow Sandbox or Production in the top bar. Sandbox shows a draft that is not published yet. Production shows only the version published there. Fold the node list to make room for the canvas. Tidy stacks each step from top to bottom. Row and column line the nodes up. Test Bot puts the cursor in the chat box. After a publish succeeds, you return to this list.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Rename and delete live on this list, next to each flow. Delete asks you to confirm. You can also rename the flow you have open by clicking its name on the canvas.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            A new bot asks how it should start. Hair studio is the Bella studio template: one greeting that asks the name, then where the studio is, the hours, the prices, or a booking. Scan my website reads a public address and the pages it links to, such as a price list, questions, and joining the team. A long price list becomes a short question, then one price, then an offer to book. Yuzu is the salon name. Bella is the name guests hear. The pages are saved under Knowledge. A cancellation rule stays off the map when the pages do not state one. The scanned welcome stays a draft until you publish it to Sandbox. Once guests are chatting, three similar helpful chats with no chapter show on Journey as a dashed draft. Connect publishes that draft to Sandbox and teaches the welcome the handoff. Corporate services is the orders, shipping, and plans script. An example conversation and a blank welcome stay drafts until you publish them to Sandbox. Charts already on another bot stay on that bot. Starter packs on the Flows page can still add a pack later. Remove pack deletes the flows, intents, and FAQs that pack added. The widget says the words in the published flow. Journey is the map of every chapter and the line between them. Test this journey starts at the welcome, follows each handoff, and highlights the chapter the guest is in. Flows is the list for publish, rename, and repair. Publish to Production when the live widget should use it.
          </p>
          <Figure file="flows.jpg" alt="Flows list" />
          <Figure file="canvas.jpg" alt="Flow canvas with the node list folded" />
        </section>

        <section id="inbox" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Inbox</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Chats are the conversations. Tickets can be opened from a chat or on their own. Contacts can be imported, exported, and turned into a conversation. Assign and transfer use a teammate, and an internal note stays off the customer widget.
          </p>
          <Figure file="inbox.jpg" alt="Inbox chats" />
        </section>

        <section id="admin-training" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Admin walkthrough</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Sign in with the Acme demo account and open Acme Support Bot. Choose Production. On the widget test page for the website channel, ask where an order is. When the bot asks for the order number, enter 1001. The reply says that order is on its way. A different number is handed to a person, because the sample shop address is not a real shop.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Open Inbox in another window. The same chat is there. Open Journey and you will see Welcome & Routing hand off to Order Status, Returns, and Billing. Analytics, then Dashboards, opens Live operations. Those numbers are the same chats as the overview.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Sandbox holds the training chats, including password resets. When three similar chats have no flow, Journey shows that draft beside the welcome, dashed, until you connect it. Publish it to Sandbox and the welcome flow learns that handoff. QA Lab keeps a copy of this bot for practice. The scratch bot there is separate.
          </p>
        </section>

        <section id="agent-training" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Agent walkthrough</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            Stay on Acme Support Bot and open Inbox. Pick one of the training chats. Assign it to a teammate, add an internal note, then Resolve. The note stays off the customer widget. The overview and Live operations count the resolved chat.
          </p>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            The marketing site has its own bot. A visitor can ask about features, the inbox, or the free plan before they create an account. Those chats land in the BotStudio company inbox, signed in as the BotStudio demo account. They do not mix with Acme.
          </p>
        </section>

        <section id="planned" className="scroll-mt-6 space-y-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Planned features</h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
            A Planned badge means that control will become a real feature. Stripe on Integrations is marked Planned. In Inbox settings, Auto-assign, Round-robin, and Bot handover on agent idle are marked Planned too. Those three do not change who answers a chat. Billing, single sign-on, and live SMS, email, and WhatsApp connections are not in the product yet.
          </p>
          <Figure file="integrations.jpg" alt="Integrations page with Stripe marked Planned" />
        </section>
      </article>
    </div>
  )
}
