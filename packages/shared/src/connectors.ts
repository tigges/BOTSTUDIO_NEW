/**
 * Connectors: a CRM or helpdesk connection is an Auth Profile plus a set of
 * ordinary HTTP tools in the Tools registry. Nothing here holds a secret; the
 * key is sealed in the Auth Profile the tools reference.
 */
import type { AuthProfileKind, ToolDraft } from './tools.js'

export const CONNECTOR_PROVIDERS = ['hubspot', 'zendesk'] as const
export type ConnectorProvider = (typeof CONNECTOR_PROVIDERS)[number]

export interface ConnectorField {
  key: string
  label: string
  placeholder: string
  help: string
}

export interface ConnectorSpec {
  provider: ConnectorProvider
  name: string
  /** Non-secret fields stored on the connection. */
  fields: ConnectorField[]
  secretLabel: string
  secretHelp: string
  profileKind: AuthProfileKind
}

export const CONNECTORS: Record<ConnectorProvider, ConnectorSpec> = {
  hubspot: {
    provider: 'hubspot',
    name: 'HubSpot',
    fields: [],
    secretLabel: 'Private app access token',
    secretHelp: 'In HubSpot: Settings → Integrations → Private apps. Give it the crm.objects.contacts read and write scopes.',
    profileKind: 'bearer',
  },
  zendesk: {
    provider: 'zendesk',
    name: 'Zendesk',
    fields: [
      { key: 'subdomain', label: 'Subdomain', placeholder: 'yourcompany', help: 'The first part of yourcompany.zendesk.com.' },
      { key: 'email', label: 'Agent email', placeholder: 'agent@yourcompany.com', help: 'The Zendesk agent the API token belongs to.' },
    ],
    secretLabel: 'API token',
    secretHelp: 'In Zendesk: Admin Center → Apps and integrations → Zendesk API. Turn on token access and add a token.',
    profileKind: 'basic',
  },
}

export function isConnector(provider: string): provider is ConnectorProvider {
  return (CONNECTOR_PROVIDERS as readonly string[]).includes(provider)
}

const SUBDOMAIN = /^[a-z0-9][a-z0-9-]{0,62}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Cleans the non-secret fields. Accepts a full Zendesk URL in the subdomain field. */
export function connectorSettings(provider: ConnectorProvider, raw: Record<string, unknown>): Record<string, string> {
  const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '')
  if (provider === 'zendesk') {
    const subdomain = text('subdomain').toLowerCase().replace(/^https?:\/\//, '').replace(/\.zendesk\.com.*$/, '').replace(/\/.*$/, '')
    return { subdomain, email: text('email') }
  }
  return {}
}

/** Everything that blocks connecting, naming the field to fix. */
export function connectorIssues(provider: ConnectorProvider, settings: Record<string, string>, secret: string | undefined, hasSecret: boolean): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = []
  const spec = CONNECTORS[provider]
  if (!secret?.trim() && !hasSecret) issues.push({ field: 'secret', message: `${spec.secretLabel}: paste it from ${spec.name}.` })
  if (provider === 'zendesk') {
    if (!SUBDOMAIN.test(settings['subdomain'] ?? '')) issues.push({ field: 'subdomain', message: 'Subdomain: enter the first part of your Zendesk address, for example yourcompany.' })
    if (!EMAIL.test(settings['email'] ?? '')) issues.push({ field: 'email', message: 'Agent email: enter the email of the Zendesk agent who owns the token.' })
  }
  return issues
}

/** Auth Profile settings for the connection. The secret goes in separately and is sealed. */
export function connectorProfileSettings(provider: ConnectorProvider, settings: Record<string, string>): Record<string, string> {
  if (provider === 'zendesk') return { username: `${settings['email'] ?? ''}/token` }
  return {}
}

export type ConnectorToolDraft = Omit<ToolDraft, 'authProfileId'>

const HTTP = { headers: {}, timeoutMs: 15_000, circuitBreaker: { failures: 5, resetSeconds: 60 }, idempotencyHeader: '' }

/** The tools "Add tools to this bot" installs. Ordinary HTTP tools: they can be edited and tested like any other. */
export function connectorTools(provider: ConnectorProvider, settings: Record<string, string>): ConnectorToolDraft[] {
  if (provider === 'hubspot') {
    return [
      {
        name: 'hubspot_find_contact',
        kind: 'http',
        description: 'Find a contact in HubSpot by email address. Use it to check whether the guest is already a customer and to read their details.',
        parameters: [{ name: 'email', type: 'string', description: 'The guest’s email address.', required: true }],
        returns: { type: 'object', description: 'HubSpot search results: total and the matching contacts with email, name, phone and lifecycle stage.' },
        effect: 'read',
        config: {
          ...HTTP,
          method: 'POST',
          url: 'https://api.hubapi.com/crm/v3/objects/contacts/search',
          body: JSON.stringify({
            filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: '{{email}}' }] }],
            properties: ['email', 'firstname', 'lastname', 'phone', 'lifecyclestage'],
            limit: 1,
          }),
          retries: 2,
        },
      },
      {
        name: 'hubspot_create_contact',
        kind: 'http',
        description: 'Create a contact in HubSpot. Use it only after the guest has agreed to be added and you have their email address.',
        parameters: [
          { name: 'email', type: 'string', description: 'The guest’s email address.', required: true },
          { name: 'firstname', type: 'string', description: 'The guest’s first name.', required: true },
          { name: 'lastname', type: 'string', description: 'The guest’s last name, if they gave it.', required: false },
          { name: 'phone', type: 'string', description: 'The guest’s phone number, if they gave it.', required: false },
        ],
        returns: { type: 'object', description: 'The new HubSpot contact, with its id.' },
        effect: 'write',
        config: {
          ...HTTP,
          method: 'POST',
          url: 'https://api.hubapi.com/crm/v3/objects/contacts',
          body: '{"properties":{"email":"{{email}}","firstname":"{{firstname}}","lastname":"{{lastname}}","phone":"{{phone}}"}}',
          retries: 0,
        },
      },
    ]
  }
  const base = `https://${settings['subdomain'] ?? ''}.zendesk.com/api/v2`
  return [
    {
      name: 'zendesk_find_tickets',
      kind: 'http',
      description: 'Find the guest’s Zendesk tickets by their email address, newest first. Use it when the guest asks about an existing request.',
      parameters: [{ name: 'email', type: 'string', description: 'The guest’s email address.', required: true }],
      returns: { type: 'object', description: 'Zendesk search results: count and tickets with id, subject, status and last update.' },
      effect: 'read',
      config: {
        ...HTTP,
        method: 'GET',
        url: `${base}/search.json?query=type%3Aticket%20requester%3A{{email}}&sort_by=updated_at&sort_order=desc`,
        body: '',
        retries: 2,
      },
    },
    {
      name: 'zendesk_create_ticket',
      kind: 'http',
      description: 'Open a Zendesk ticket for the guest. Use it when the request needs follow-up by the team and the guest has given their email.',
      parameters: [
        { name: 'subject', type: 'string', description: 'A short summary of the request.', required: true },
        { name: 'description', type: 'string', description: 'What the guest needs, in their words.', required: true },
        { name: 'email', type: 'string', description: 'The guest’s email address.', required: true },
        { name: 'name', type: 'string', description: 'The guest’s name.', required: true },
      ],
      returns: { type: 'object', description: 'The new Zendesk ticket, with its id and status.' },
      effect: 'write',
      config: {
        ...HTTP,
        method: 'POST',
        url: `${base}/tickets.json`,
        body: '{"ticket":{"subject":"{{subject}}","comment":{"body":"{{description}}"},"requester":{"email":"{{email}}","name":"{{name}}"}}}',
        retries: 0,
      },
    },
  ]
}
