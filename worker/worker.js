// Cloudflare Worker for schema-mapper
// - GET  /?org=<orgId>              — enterprise-status probe
// - POST /submit                    — customer schema submission
// - GET  /curated-layouts?orgId&projectId&dataset&workspace  — list layouts
// - GET  /curated-layouts/:id       — read one
// - POST /curated-layouts           — create
// - PATCH /curated-layouts/:id      — update
// - DELETE /curated-layouts/:id     — delete
//
// Deploys to sanity-enterprise-check.gongapi.workers.dev
// Bindings required in env:
//   SANITY_C360_TOKEN            — read C360 (project hzao7xsp)
//   SANITY_SCHEMA_EXPORT_TOKEN   — write project a9vrwh4v/production

const OVERRIDE_ORGS = new Set([
  'o02mZUBKf', // Adam's org
  'oSyH1iET5', // Sanity org
])

const C360_PROJECT_ID = 'hzao7xsp'
const C360_DATASET = 'production'
const EXPORT_PROJECT_ID = 'a9vrwh4v'
const EXPORT_DATASET = 'production'
const SANITY_API_VERSION = '2024-01-01'

const ENTERPRISE_QUERY =
  'count(*[_type == "customer" && count(contracts[orgId == $orgId && status == "Active" && planTier match "Enterprise*"]) > 0]) > 0'

// ---------- CORS ----------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {...CORS_HEADERS, ...(init.headers || {})},
  })
}

// ---------- Enterprise probe ----------

async function checkEnterprise(orgId, token) {
  const url = new URL(
    `https://${C360_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${C360_DATASET}`,
  )
  url.searchParams.set('query', ENTERPRISE_QUERY)
  url.searchParams.set('$orgId', JSON.stringify(orgId))
  const res = await fetch(url.toString(), {
    headers: {Authorization: `Bearer ${token}`},
  })
  if (!res.ok) throw new Error(`Sanity API error: ${res.status}`)
  const data = await res.json()
  return data.result === true
}

// ---------- Submissions (unchanged) ----------

async function submitSchema(payload, token) {
  const orgId = payload.org?.id || 'unknown'
  const projectId = payload.project?.id || 'unknown'
  const datasetName = payload.dataset?.name || 'unknown'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const docId = `export-${orgId}-${projectId}-${datasetName}-${timestamp}`
  const doc = {
    _id: docId,
    _type: 'schemaExport',
    orgId,
    submittedAt: new Date().toISOString(),
    payload: JSON.stringify(payload),
  }
  const mutations = [{createOrReplace: doc}]
  const url = `https://${EXPORT_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/mutate/${EXPORT_DATASET}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({mutations}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Sanity mutation failed: ${res.status} ${text}`)
  }
  return {docId}
}

// ---------- Curated layouts ----------

function generateUlid() {
  // Simple lexicographically-sortable ID: <base36 timestamp>-<random>
  const ts = Date.now().toString(36).padStart(9, '0')
  const rnd = crypto.getRandomValues(new Uint8Array(10))
  const hex = Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${ts}${hex}`
}

async function sanityFetch(query, params, token) {
  const url = new URL(
    `https://${EXPORT_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${EXPORT_DATASET}`,
  )
  url.searchParams.set('query', query)
  for (const [k, v] of Object.entries(params || {})) {
    url.searchParams.set(`$${k}`, JSON.stringify(v))
  }
  const res = await fetch(url.toString(), {
    headers: {Authorization: `Bearer ${token}`},
  })
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status}`)
  return (await res.json()).result
}

async function sanityMutate(mutations, token) {
  const url = `https://${EXPORT_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/mutate/${EXPORT_DATASET}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({mutations, returnDocuments: true}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Sanity mutation failed: ${res.status} ${text}`)
  }
  return res.json()
}

async function listCuratedLayouts({orgId, projectId, dataset, workspace}, token) {
  const query = `*[_type == "curatedLayout"
      && orgId == $orgId
      && projectId == $projectId
      && dataset == $dataset
      && workspace == $workspace
    ] | order(updatedAt desc) {
      _id,
      name,
      createdAt,
      updatedAt,
      createdBy
    }`
  return sanityFetch(
    query,
    {orgId, projectId, dataset, workspace: workspace || 'default'},
    token,
  )
}

async function getCuratedLayout(id, token) {
  const query = `*[_type == "curatedLayout" && _id == $id][0]`
  return sanityFetch(query, {id}, token)
}

async function createCuratedLayout(body, token) {
  const now = new Date().toISOString()
  const id = `curated-${body.orgId}-${body.projectId}-${body.dataset}-${body.workspace || 'default'}-${generateUlid()}`
  const doc = {
    _id: id,
    _type: 'curatedLayout',
    orgId: body.orgId,
    projectId: body.projectId,
    dataset: body.dataset,
    workspace: body.workspace || 'default',
    name: body.name || 'Untitled layout',
    createdAt: now,
    updatedAt: now,
    createdBy: body.createdBy,
    views: body.views || {},
  }
  await sanityMutate([{create: doc}], token)
  return doc
}

async function patchCuratedLayout(id, patch, token) {
  const set = {updatedAt: new Date().toISOString()}
  // Whitelist of mutable fields
  if (typeof patch.name === 'string') set.name = patch.name
  if (patch.views && typeof patch.views === 'object') set.views = patch.views
  await sanityMutate([{patch: {id, set}}], token)
  return {id, ...set}
}

async function patchCuratedLayoutView(id, viewKey, view, token) {
  // Patch a single view without overwriting other views.
  // Uses Sanity's key-path patch (set on views.<viewKey>).
  const set = {
    updatedAt: new Date().toISOString(),
    [`views.${viewKey}`]: view,
  }
  await sanityMutate([{patch: {id, set}}], token)
  return {id, viewKey}
}

async function deleteCuratedLayout(id, token) {
  await sanityMutate([{delete: {id}}], token)
  return {id}
}

// ---------- Router ----------

async function handleCuratedLayoutsRoute(request, url, env) {
  const token = env.SANITY_SCHEMA_EXPORT_TOKEN
  const parts = url.pathname.split('/').filter(Boolean) // ['curated-layouts', maybe id, maybe 'views', maybe viewKey]
  const id = parts[1]
  const isViewSubroute = parts[2] === 'views'
  const viewKey = parts[3]

  // GET /curated-layouts
  if (request.method === 'GET' && !id) {
    const orgId = url.searchParams.get('orgId')
    const projectId = url.searchParams.get('projectId')
    const dataset = url.searchParams.get('dataset')
    const workspace = url.searchParams.get('workspace') || 'default'
    if (!orgId || !projectId || !dataset) {
      return json({error: 'Missing orgId/projectId/dataset'}, {status: 400})
    }
    const layouts = await listCuratedLayouts({orgId, projectId, dataset, workspace}, token)
    return json({layouts})
  }

  // GET /curated-layouts/:id
  if (request.method === 'GET' && id && !isViewSubroute) {
    const layout = await getCuratedLayout(id, token)
    if (!layout) return json({error: 'Not found'}, {status: 404})
    return json({layout})
  }

  // POST /curated-layouts
  if (request.method === 'POST' && !id) {
    const body = await request.json()
    if (!body.orgId || !body.projectId || !body.dataset) {
      return json({error: 'Missing orgId/projectId/dataset'}, {status: 400})
    }
    const doc = await createCuratedLayout(body, token)
    return json({layout: doc})
  }

  // PUT /curated-layouts/:id/views/:viewKey  (surgical single-view save)
  if ((request.method === 'PUT' || request.method === 'POST') && id && isViewSubroute && viewKey) {
    const body = await request.json()
    const result = await patchCuratedLayoutView(id, viewKey, body, token)
    return json(result)
  }

  // PATCH /curated-layouts/:id  (name and/or full views)
  if (request.method === 'PATCH' && id) {
    const body = await request.json()
    const result = await patchCuratedLayout(id, body, token)
    return json(result)
  }

  // DELETE /curated-layouts/:id
  if (request.method === 'DELETE' && id) {
    await deleteCuratedLayout(id, token)
    return json({id, deleted: true})
  }

  return json({error: 'Method not allowed'}, {status: 405})
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {headers: CORS_HEADERS})
    }
    const url = new URL(request.url)
    const path = url.pathname

    // POST /submit — customer schema submission (existing)
    if (request.method === 'POST' && path === '/submit') {
      try {
        const payload = await request.json()
        const result = await submitSchema(payload, env.SANITY_SCHEMA_EXPORT_TOKEN)
        return json({success: true, docId: result.docId})
      } catch (err) {
        return json({success: false, error: err.message}, {status: 500})
      }
    }

    // /curated-layouts/*
    if (path === '/curated-layouts' || path.startsWith('/curated-layouts/')) {
      try {
        return await handleCuratedLayoutsRoute(request, url, env)
      } catch (err) {
        return json({error: err.message}, {status: 500})
      }
    }

    // GET / — enterprise-status probe (existing)
    const orgId = url.searchParams.get('org') || url.searchParams.get('orgId')
    if (!orgId) {
      return json({error: 'Missing orgId parameter'}, {status: 400})
    }
    try {
      if (OVERRIDE_ORGS.has(orgId)) {
        return json({orgId, isEnterprise: true, source: 'override'})
      }
      const isEnterprise = await checkEnterprise(orgId, env.SANITY_C360_TOKEN)
      return json({orgId, isEnterprise, source: 'c360'})
    } catch (err) {
      return json(
        {orgId, isEnterprise: false, error: err.message, source: 'error'},
        {status: 500},
      )
    }
  },
}
