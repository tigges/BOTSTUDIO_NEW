import React from 'react'
import { useLocation } from '@tanstack/react-router'
import { SubNav } from '../../../components/SubNav'
import { useEntities, useIntents } from '../../../lib/hooks'
import { knowledgeTabs } from '../../../lib/build-nav'

/** In the order a knowledge base is built and checked: what goes in, how it came out, what a question finds. */
export function KnowledgeSubNav() {
  const { pathname } = useLocation()
  const intents = useIntents()
  const entities = useEntities()
  return <SubNav items={knowledgeTabs({ intents: intents.data?.length, entities: entities.data?.length }, pathname)} />
}
