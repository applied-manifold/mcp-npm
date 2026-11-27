/** Local tools/list catalog for unauthenticated stdio. Keep descriptions
 * aligned with the hosted Spatial Compiler MCP: what each tool does and
 * returns, nothing about how a model should behave. */

const MODULES = ['pyrofx', 'pyro', 'meshfx', 'geofx'];
const QUALITIES = ['draft', 'final'];
const SHADOW_SECTORS = [0, 8, 16, 32];

const axis = {
  type: 'object',
  properties: { key: { type: 'string' }, values: { type: 'array', minItems: 1 } },
  required: ['key', 'values'],
};

function jobProperties() {
  return {
    module: {
      type: 'string',
      enum: MODULES,
      description:
        'Module id. pyro and pyrofx are the same fire, smoke, dust and explosion module. meshfx takes one GLB. geofx takes a .geo.toml terrain spec and up to four inputs. Optional when spec_name ends in a module extension.',
    },
    operation: {
      type: 'string',
      enum: ['check', 'bake', 'sweep'],
      default: 'bake',
      description: 'check is free and answered inline; bake and sweep are async jobs.',
    },
    spec: {
      type: ['string', 'object'],
      description: 'The spec as TOML text, or the same tree as a JSON object. Fields come from the module schema.',
    },
    spec_name: { type: 'string', description: 'File name <name>.<module>.toml, e.g. campfire.pyro.toml' },
    set: { type: 'array', items: { type: 'string' }, description: 'Overrides, each section.key=value' },
    terrain_shadows: {
      type: 'integer',
      enum: SHADOW_SECTORS,
      description: 'geofx horizon sectors. Zero disables terrain shadows.',
    },
    quality: { type: 'string', enum: QUALITIES, description: 'draft or final. Bakes default to final. Batches and sweeps default to draft.' },
    seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    batch: {
      type: 'object',
      description: 'Run variations in list, axis and seed order.',
      additionalProperties: false,
      properties: {
        variations: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              set: { type: 'array', items: { type: 'string' } },
              seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
              quality: { enum: QUALITIES },
              terrain_shadows: { enum: SHADOW_SECTORS },
            },
          },
        },
        axes: { type: 'array', items: axis, minItems: 1 },
        seeds: {
          oneOf: [
            { type: 'array', minItems: 1, items: { type: 'integer', minimum: 0, maximum: 4294967295 } },
            { type: 'object', properties: { from: { type: 'integer', minimum: 0 }, count: { type: 'integer', minimum: 1 } }, required: ['from', 'count'] },
          ],
        },
        max_concurrency: { type: 'integer', minimum: 1 },
        on_failure: { enum: ['continue', 'stop'] },
      },
    },
    sweep: {
      anyOf: [axis, { type: 'array', items: axis, minItems: 1 }],
      description: 'For operation sweep: one {key, values}, or a list of axes with different keys.',
    },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { input_id: { type: 'string' }, as: { type: 'string' } },
        required: ['input_id', 'as'],
      },
      description: 'Registered input files, named in the spec by `as`.',
    },
    max_cost_usd: { type: 'number', minimum: 0, description: 'Refuse (COST_LIMIT) if this job would cost more. Batches and sweeps also require the accepted quote ID.' },
  };
}

const detail = {
  type: 'string',
  enum: ['lean', 'compact', 'files', 'full', 'status'],
  default: 'compact',
  description:
    'compact (the default, also called files): state, charge and each artifact once, plus one signed download base and a zip URL. lean is the same with less QA. full is the large report and a signed URL per file. status is per-job or per-variant state and charge only.',
};

const waitMs = {
  type: 'integer',
  minimum: 0,
  maximum: 35000,
  description: 'Maximum milliseconds to wait for the job to finish, up to 35 seconds.',
};

const estimateProperties = {
  ...jobProperties(),
  price_cursor: { type: 'string', description: 'For a large run, pass sweep.price_cursor or the preceding sweep.next_cursor to read up to 100 row prices.' },
  idempotency_key: { type: 'string', description: 'For a batch or sweep retry, supply its original key to estimate the stored quote and incremental daily allowance.' },
};

const submitProperties = {
  ...jobProperties(),
  operation: {
    type: 'string',
    enum: ['check', 'inspect', 'bake', 'sweep'],
    default: 'bake',
    description: 'Check a spec or inspect a finished job inline for free. Bake and sweep create jobs.',
  },
  job_id: { type: 'string', description: 'Finished job to inspect.' },
  compare_job_id: { type: 'string', description: 'Earlier job to compare with job_id.' },
  measure_between: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2, description: 'Two positioned part paths to measure in metres.' },
  part: { type: 'string', description: 'Exact path returned in inspect.parts.' },
  frame: { type: 'integer', minimum: 0, description: 'Zero-based flipbook frame to isolate.' },
  image: { type: 'boolean', default: true, description: 'Include a framed inspect still when available. False returns numbers only.' },
  include_preview: { type: 'boolean', default: true },
  wait_ms: waitMs,
  detail,
  idempotency_key: {
    type: 'string',
    description:
      'Caller-chosen key. A retry with the same key and body returns the original job. A different body returns IDEMPOTENCY_CONFLICT. Without a key, an identical bake within 10 minutes of a succeeded job for this API key returns that job and is not charged again.',
  },
  accept_quote: { type: 'string', description: 'Quote id (q_...). Required for every batch and sweep, including at the usual price.' },
  max_price_usd: { type: 'number', minimum: 0, description: 'Maximum price in US dollars. Every batch and sweep also requires accept_quote.' },
};

function tool(name, title, description, inputSchema, annotations) {
  return { name, title, description, inputSchema, annotations: { title, ...annotations } };
}

export const TOOLS = [
  tool(
    'discover',
    'Discover modules, schemas and recipes',
    "Lists hosted modules, operations, status, and prices. Call this before estimate or submit to find a valid module, recipe, or example. With a module, returns that module's schema, examples, input slots, prices, and recipe names. With a module and a recipe or example, returns that preset spec. recipe and example are ignored unless a module is also set.",
    {
      type: 'object',
      properties: {
        module: { type: 'string', enum: MODULES, description: 'Module id. pyro and pyrofx are the same fire, smoke, dust and explosion module.' },
        recipe: { type: 'string', description: 'A named preset, e.g. fireball' },
        example: { type: 'string', description: 'An example file, e.g. fireball.pyro.toml' },
      },
    },
    { readOnlyHint: true, openWorldHint: false },
  ),
  tool(
    'add_input',
    'Register an input file',
    'Registers a file a job will read. Send filename, byte size, and sha256 to get an input_id and an upload_url for a PUT of those exact bytes. A file already stored under the same SHA-256 is ready at once. For small text files, send filename and text.',
    {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        bytes: { type: 'integer', minimum: 1 },
        sha256: { type: 'string' },
        content_type: { type: 'string', description: 'MIME type of the bytes, for example model/gltf-binary. Optional; inferred from the filename when omitted.' },
        text: { type: 'string' },
        idempotency_key: { type: 'string', description: 'Caller-chosen key. A retry with the same key and the same file returns the original input. A different file with the same key returns IDEMPOTENCY_CONFLICT.' },
      },
      required: ['filename'],
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  ),
  tool(
    'estimate',
    'Estimate price and time',
    'Validates a job without running it or charging. Call this before submit to see the price and time. Prefer this over submit with operation check when you only need pricing; use submit check when you need the validation report. Returns the price (price_usd, usual_price_usd, meter, breakdown, knobs), a one-line summary, whether the cache will hit, a quote, and a labeled time estimate. accept_required is true when the price is above the usual one. quote_required is true for batches and sweeps, and the quote id is in the result. A bake also includes the draft and final price of the same spec. A sweep includes its price range, axes, and parts. Large runs paginate per_variant with price_cursor. too_large names a knob that would bring the run under the time limit. quote_warning may include a suggested domain.voxel_m and price.',
    { type: 'object', properties: estimateProperties, required: ['spec'] },
    { readOnlyHint: true, openWorldHint: false },
  ),
  tool(
    'submit',
    'Run an operation',
    'Runs check, inspect, bake, or sweep. check validates a spec and returns the report inline, at no charge. inspect measures or compares a finished job by job_id, at no charge. bake and sweep start an async job, charge for completed work, and return the job, waiting up to wait_ms. Batches and sweeps need accept_quote, including free repeats. When a bake is above the usual price and accept_quote or max_price_usd is missing, returns PRICE_ACCEPT_REQUIRED with the quote, and nothing runs or is charged.',
    {
      type: 'object',
      properties: submitProperties,
      if: { properties: { operation: { const: 'inspect' } }, required: ['operation'] },
      then: { required: ['job_id'] },
      else: { required: ['spec'] },
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  ),
  tool(
    'get_job',
    'Get a job, or list jobs',
    'Returns a job by job_id or idempotency_key: state, charge, and when succeeded each artifact once (path, bytes, sha256), one signed download base, a zip URL, warnings, compact QA, and preview_url. Waits up to wait_ms. Build a file URL as {download.base}{path}?{download.token}. detail=full returns the large report and a signed URL per file. detail=status returns state and charge only. Without job_id or idempotency_key, returns a page of recent jobs, which can be filtered by spec_name or state.',
    {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'The job_id returned by submit.' },
        idempotency_key: { type: 'string', description: 'The idempotency_key of the job to return.' },
        wait_ms: waitMs,
        batch: { type: 'string', description: "Batch job_id. When set, list that batch's child jobs instead of recent jobs." },
        include_preview: {
          type: 'boolean',
          description: 'Include a framed inspect still. Default true only for detail=full; compact and lean return the preview path on the download base instead.',
        },
        detail,
        state: { type: 'string', enum: ['queued', 'dispatched', 'running', 'succeeded', 'partial', 'failed', 'cancelled', 'rejected'] },
        spec_name: { type: 'string', description: 'When listing jobs, keep rows whose spec name matches.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size when listing jobs. Defaults to 20. Minimum 1, maximum 100.' },
        cursor: { type: 'string', description: "Opaque cursor from a previous list's next_cursor. Pass it to read the next page." },
      },
    },
    { readOnlyHint: true, openWorldHint: false },
  ),
  tool(
    'cancel_job',
    'Cancel a job',
    'Cancels a queued job, or stops the remaining parts of a sweep that spans several sheets. Returns the updated job. Do not use this to check status or to download results; call get_job for that. A bake that has already been dispatched cannot be cancelled.',
    { type: 'object', properties: { job_id: { type: 'string', description: 'The job_id returned by submit. This is not an idempotency_key.' } }, required: ['job_id'] },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  ),
];

export const INSTRUCTIONS =
  'Spatial Compiler compiles engine-ready 3D from a TOML spec through the hosted MCP at https://mcp.spatialcompiler.dev. ' +
  'This process has no API key, so it can only list tools. Set SPATIAL_API_KEY from https://console.appliedmanifold.com, ' +
  'or run `npx -y @applied-manifold/spatial-compiler login` in a terminal, then restart the server to compile, estimate, or inspect jobs.';
