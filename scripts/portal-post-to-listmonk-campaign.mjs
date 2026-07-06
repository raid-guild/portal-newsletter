#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_PORTAL_URL = 'https://portal.raidguild.org'
const DEFAULT_LISTMONK_URL = 'https://updates.raidguild.org'
const DEFAULT_FROM_EMAIL = 'RaidGuild <updates@updates.raidguild.org>'
const DEFAULT_OUTPUT_DIR = 'exports/campaigns'

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

const portalURL = stripTrailingSlash(args.portalUrl || env('PORTAL_URL') || DEFAULT_PORTAL_URL)
const listmonkURL = stripTrailingSlash(
  args.listmonkUrl || env('LISTMONK_URL') || DEFAULT_LISTMONK_URL,
)
const postID = args.postId || env('PORTAL_POST_ID')
const outputDir = args.outputDir || env('OUTPUT_DIR') || DEFAULT_OUTPUT_DIR
const createCampaign = Boolean(args.createCampaign)
const testEmail = args.testEmail || env('TEST_EMAIL')

if (!postID) fail('Missing post ID. Pass --post-id 68 or set PORTAL_POST_ID=68.')

const portalToken = await getPortalToken({ portalURL })
const post = await fetchPortalPost({ portalToken, portalURL, postID })
const title = stringValue(post.title) || `Portal post ${postID}`
const subject = args.subject || env('CAMPAIGN_SUBJECT') || title
const campaignName = args.name || env('CAMPAIGN_NAME') || `Portal post ${postID}: ${title}`
const slug = stringValue(post.slug) || `post-${postID}`
const postURL = `${portalURL}/posts/${slug}`
const rendered = renderEmailBody({ post, portalURL, postURL, subject })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const baseName = `${slug}-${timestamp}`

await mkdir(outputDir, { recursive: true })

const htmlPath = path.join(outputDir, `${baseName}.html`)
const textPath = path.join(outputDir, `${baseName}.txt`)
const metadataPath = path.join(outputDir, `${baseName}.json`)

await writeFile(htmlPath, rendered.html)
await writeFile(textPath, rendered.text)
await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      campaignName,
      htmlPath,
      postID,
      postURL,
      subject,
      textPath,
      title,
    },
    null,
    2,
  )}\n`,
)

console.log(`Wrote ${htmlPath}`)
console.log(`Wrote ${textPath}`)
console.log(`Wrote ${metadataPath}`)

if (createCampaign) {
  const listIDs = parseIDList(args.listIds || env('LISTMONK_LIST_IDS'))
  const templateID = numberValue(args.templateId || env('LISTMONK_TEMPLATE_ID'))

  if (!listIDs.length) fail('Creating a campaign requires --list-ids 1,2 or LISTMONK_LIST_IDS.')
  if (!templateID) fail('Creating a campaign requires --template-id or LISTMONK_TEMPLATE_ID.')

  const campaign = await createListmonkCampaign({
    body: rendered.html,
    campaignName,
    fromEmail: args.fromEmail || env('LISTMONK_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
    listIDs,
    listmonkURL,
    subject,
    templateID,
    text: rendered.text,
  })

  console.log(`Created listmonk draft campaign ${campaign.id}: ${campaign.name}`)

  if (testEmail) {
    await sendCampaignTest({
      campaignID: campaign.id,
      email: testEmail,
      listmonkURL,
    })

    console.log(`Sent test campaign email to ${testEmail}`)
  }
} else {
  console.log('Skipped listmonk campaign creation. Pass --create-campaign to create a draft.')
}

async function getPortalToken({ portalURL }) {
  const explicitToken = env('PORTAL_JWT')
  if (explicitToken) return explicitToken

  const email = env('PORTAL_EMAIL')
  const password = env('PORTAL_PASSWORD')
  if (!email || !password) return ''

  const response = await fetch(`${portalURL}/api/users/login`, {
    body: JSON.stringify({ email, password }),
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    fail(`Portal login failed: ${response.status} ${await response.text()}`)
  }

  const body = await response.json()
  return body.token || ''
}

async function fetchPortalPost({ portalToken, portalURL, postID }) {
  const url = new URL(`${portalURL}/api/posts/${encodeURIComponent(postID)}`)
  url.searchParams.set('depth', '3')
  url.searchParams.set('draft', 'true')

  const headers = portalToken ? { authorization: `JWT ${portalToken}` } : {}
  const response = await fetch(url, { headers })

  if (!response.ok) {
    fail(`Failed to fetch Portal post ${postID}: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

async function createListmonkCampaign({
  body,
  campaignName,
  fromEmail,
  listIDs,
  listmonkURL,
  subject,
  templateID,
  text,
}) {
  const response = await listmonkFetch({
    body: {
      altbody: text,
      body,
      content_type: 'html',
      from_email: fromEmail,
      lists: listIDs,
      messenger: 'email',
      name: campaignName,
      subject,
      tags: ['portal-post'],
      template_id: templateID,
      type: 'regular',
    },
    listmonkURL,
    method: 'POST',
    path: '/api/campaigns',
  })

  return response.data
}

async function sendCampaignTest({ campaignID, email, listmonkURL }) {
  await listmonkFetch({
    body: {
      subscribers: [email],
    },
    listmonkURL,
    method: 'POST',
    path: `/api/campaigns/${campaignID}/test`,
  })
}

async function listmonkFetch({ body, listmonkURL, method, path }) {
  const user = env('LISTMONK_API_USER')
  const token = env('LISTMONK_API_TOKEN')

  if (!user || !token) {
    fail('Missing LISTMONK_API_USER or LISTMONK_API_TOKEN.')
  }

  const response = await fetch(`${listmonkURL}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`,
      'content-type': 'application/json',
    },
    method,
  })

  if (!response.ok) {
    fail(`listmonk ${method} ${path} failed: ${response.status} ${await response.text()}`)
  }

  const contentType = response.headers.get('content-type') || ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

function renderEmailBody({ post, portalURL, postURL, subject }) {
  const chunks = []
  chunks.push(
    `<p style="margin:0 0 12px;color:#d7a846;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">RaidGuild Update</p>`,
  )
  chunks.push(
    `<h1 style="margin:0 0 20px;color:#fff6df;font-size:32px;line-height:1.15;">${escapeHTML(subject)}</h1>`,
  )
  chunks.push(renderNodes(post.content?.root?.children || [], { portalURL }))
  chunks.push(
    `<p style="margin:32px 0 0;"><a href="${escapeAttribute(postURL)}" style="display:inline-block;background:#d7a846;color:#16110d;padding:13px 18px;text-decoration:none;font-size:13px;font-weight:700;">Open in Portal</a></p>`,
  )

  const html = chunks.filter(Boolean).join('\n')
  const text = htmlToText(`${subject}\n\n${renderText(post.content?.root?.children || [])}\n\n${postURL}`)

  return { html, text }
}

function renderNodes(nodes, context) {
  if (!Array.isArray(nodes)) return ''

  return nodes.map((node) => renderNode(node, context)).filter(Boolean).join('\n')
}

function renderNode(node, context) {
  if (!node || typeof node !== 'object') return ''

  switch (node.type) {
    case 'text':
      return renderFormattedText(node)
    case 'linebreak':
      return '<br />'
    case 'paragraph': {
      const children = renderNodes(node.children, context).trim()
      if (!children) return ''
      return `<p style="margin:0 0 16px;color:#f6efe2;font-size:16px;line-height:1.65;">${children}</p>`
    }
    case 'heading': {
      const children = renderNodes(node.children, context).trim()
      if (!children) return ''
      const tag = ['h1', 'h2', 'h3', 'h4'].includes(node.tag) ? node.tag : 'h2'
      const styles = {
        h1: 'font-size:30px;line-height:1.18;margin:30px 0 14px;',
        h2: 'font-size:24px;line-height:1.25;margin:30px 0 12px;',
        h3: 'font-size:20px;line-height:1.3;margin:26px 0 10px;',
        h4: 'font-size:17px;line-height:1.35;margin:22px 0 10px;',
      }
      return `<${tag} style="${styles[tag]}color:#fff6df;">${children}</${tag}>`
    }
    case 'list': {
      const tag = node.tag === 'ol' ? 'ol' : 'ul'
      const children = renderNodes(node.children, context).trim()
      if (!children) return ''
      return `<${tag} style="margin:0 0 18px 22px;padding:0;color:#f6efe2;font-size:16px;line-height:1.6;">${children}</${tag}>`
    }
    case 'listitem': {
      return `<li style="margin:0 0 8px;">${renderNodes(node.children, context)}</li>`
    }
    case 'quote': {
      const children = renderNodes(node.children, context).trim()
      if (!children) return ''
      return `<blockquote style="margin:22px 0;padding:14px 18px;border-left:3px solid #d7a846;background:#25211d;color:#f6efe2;">${children}</blockquote>`
    }
    case 'autolink':
    case 'link': {
      const url = safeURL(node.fields?.url, context.portalURL)
      const children = renderNodes(node.children, context).trim() || escapeHTML(url)
      if (!url) return children
      return `<a href="${escapeAttribute(url)}" style="color:#d7a846;text-decoration:underline;">${children}</a>`
    }
    case 'upload': {
      return renderMedia(node.value, context)
    }
    case 'block': {
      const block = node.fields || {}
      if (block.blockType === 'mediaBlock') return renderMedia(block.media, context)
      if (block.blockType === 'banner') return renderBanner(block)
      if (block.blockType === 'code') return renderCode(block)
      return ''
    }
    default:
      return renderNodes(node.children, context)
  }
}

function renderFormattedText(node) {
  let html = escapeHTML(node.text || '')
  const format = Number(node.format || 0)

  if (format & 1) html = `<strong>${html}</strong>`
  if (format & 2) html = `<em>${html}</em>`
  if (format & 4) html = `<s>${html}</s>`
  if (format & 8) html = `<u>${html}</u>`
  if (format & 16) html = `<code>${html}</code>`

  return html
}

function renderMedia(media, { portalURL }) {
  if (!media || typeof media !== 'object') return ''

  const url = absoluteURL(media.url || media.sizes?.large?.url || media.sizes?.medium?.url, portalURL)
  if (!url) return ''

  const alt = escapeAttribute(media.alt || '')
  const caption = media.caption?.root?.children?.length
    ? `<div style="margin:8px 0 22px;color:#b8ad9b;font-size:13px;line-height:1.5;">${renderNodes(media.caption.root.children, { portalURL })}</div>`
    : ''

  return `
<figure style="margin:24px 0;">
  <img src="${escapeAttribute(url)}" alt="${alt}" style="display:block;width:100%;max-width:620px;height:auto;border:1px solid #3b3328;" />
  ${caption}
</figure>`.trim()
}

function renderBanner(block) {
  const content = block.content?.root?.children?.length
    ? renderNodes(block.content.root.children, { portalURL: DEFAULT_PORTAL_URL })
    : escapeHTML(block.text || '')

  return `<div style="margin:22px 0;padding:16px 18px;background:#25211d;border:1px solid #3b3328;color:#f6efe2;">${content}</div>`
}

function renderCode(block) {
  return `<pre style="margin:22px 0;padding:16px;background:#0d0c0b;color:#f6efe2;overflow:auto;"><code>${escapeHTML(block.code || '')}</code></pre>`
}

function renderText(nodes) {
  if (!Array.isArray(nodes)) return ''

  return nodes
    .map((node) => {
      if (!node || typeof node !== 'object') return ''
      if (node.type === 'text') return node.text || ''
      if (node.type === 'upload') return ''
      return renderText(node.children || node.fields?.content?.root?.children || [])
    })
    .filter(Boolean)
    .join(' ')
}

function htmlToText(value) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|h4|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function safeURL(value, baseURL) {
  if (!value || typeof value !== 'string') return ''

  try {
    const url = new URL(value, baseURL)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : ''
  } catch {
    return ''
  }
}

function absoluteURL(value, baseURL) {
  if (!value || typeof value !== 'string') return ''

  try {
    return new URL(value, baseURL).toString()
  } catch {
    return ''
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      continue
    }

    if (arg === '--create-campaign') {
      parsed.createCampaign = true
      continue
    }

    if (!arg.startsWith('--')) continue

    const key = arg
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const next = argv[index + 1]
    parsed[key] = next
    index += 1
  }

  return parsed
}

function parseIDList(value) {
  if (!value) return []

  return String(value)
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function numberValue(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function env(name) {
  return process.env[name]?.trim()
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHTML(value).replace(/`/g, '&#96;')
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function printHelp() {
  console.log(`Create listmonk-ready email HTML from a Portal post.

Usage:
  PORTAL_JWT=... node scripts/portal-post-to-listmonk-campaign.mjs --post-id 68

Create a draft listmonk campaign:
  PORTAL_JWT=... \\
  LISTMONK_API_USER=... \\
  LISTMONK_API_TOKEN=... \\
  LISTMONK_TEMPLATE_ID=1 \\
  LISTMONK_LIST_IDS=1 \\
  node scripts/portal-post-to-listmonk-campaign.mjs --post-id 68 --create-campaign

Options:
  --post-id <id>            Portal post ID.
  --subject <subject>       Campaign subject. Defaults to post title.
  --name <name>             Internal listmonk campaign name.
  --template-id <id>        listmonk campaign template ID.
  --list-ids <ids>          Comma-separated listmonk list IDs.
  --test-email <email>      Send a test after creating the draft campaign.
  --create-campaign         Create a draft listmonk campaign.
  --output-dir <path>       Output directory. Defaults to exports/campaigns.
`)
}
