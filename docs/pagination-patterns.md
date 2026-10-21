# Advanced Pagination Patterns for High-Volume Data Fetching

This guide provides architectural and practical patterns for ingesting high-volume Stellar datasets through StellarKit API. While standard pagination works for interactive UIs, enterprise data pipelines, indexers, and compliance audit jobs require resilient, high-throughput pagination strategies.

---

## Table of Contents

1. [Pagination Mechanics Overview](#pagination-mechanics-overview)
2. [Sequential Pagination with Cursor Resumption](#sequential-pagination-with-cursor-resumption)
3. [Detecting Terminal Pages (hasMore and nextCursor)](#detecting-terminal-pages-hasmore-and-nextcursor)
4. [Recommended Page Sizes by Use Case](#recommended-page-sizes-by-use-case)
5. [Parallel Pagination Across Multiple Accounts](#parallel-pagination-across-multiple-accounts)
6. [Complete Node.js Example: Streaming Account Transactions](#complete-nodejs-example-streaming-account-transactions)
7. [Error Recovery & Rate Limit Backoff](#error-recovery--rate-limit-backoff)
8. [Related Guides](#related-guides)

---

## Pagination Mechanics Overview

StellarKit API normalizes Horizon's underlying cursor mechanics into standard envelope responses:

\\\json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "total": 200,
    "limit": 200,
    "order": "asc",
    "nextCursor": "137424838656-1",
    "hasMore": true
  }
}
\\\

- **\cursor\ parameter**: An opaque pagination token (e.g. \137424838656-1\). When passed, the API returns records strictly *after* (or before, if \order=desc\) that token.
- **\
extCursor\**: The paging token of the last element returned in the current batch. Use this token as the \cursor\ for your subsequent query.
- **\hasMore\**: Boolean indicating whether additional records exist beyond the current window.

---

## Sequential Pagination with Cursor Resumption

When syncing millions of records, long-running processes may terminate due to container restarts, network timeouts, or deployments. Cursor resumption ensures pipelines resume from the exact point of interruption without duplicate processing or missing records.

### Resumption Lifecycle Architecture

\\\	ext
[Pipeline Worker]
       │
       ▼
 1. Read last_cursor from Persistent Store (PostgreSQL / Redis)
       │
       ▼
 2. GET /account/:id/payments?cursor={last_cursor}&limit=200&order=asc
       │
       ▼
 3. Process Batch in Database Transaction
       │
       ▼
 4. Commit records & atomically update last_cursor = response.meta.nextCursor
       │
       ▼
 5. If hasMore === true, repeat from Step 2
\\\

### Key Principles for Resumption
1. **Always Use Ascending Order (\order=asc\) for Historical Syncs**:
   - Descending order (\desc\) is ideal for "most recent first" UI dashboards.
   - Ascending order (\sc\) guarantees that newly closed ledgers do not shift offsets or invalidate already-indexed positions.
2. **Atomic Cursor Checkpointing**:
   - Always commit the data batch and the new \
extCursor\ inside the same database transaction.
   - If the worker crashes mid-batch, the uncommitted cursor rollback ensures zero data loss upon restart.
3. **Cursor Format Safety**:
   - Cursors are opaque strings. Never parse or perform mathematical incrementation on cursors. Always pass the exact string provided in \meta.nextCursor\.

---

## Detecting Terminal Pages (hasMore and nextCursor)

A common bug in data ingestion loops is infinite requesting or premature termination on page boundaries.

### Termination Evaluation Rules

A pagination loop must stop when **any** of the following conditions is met:

1. **\meta.hasMore === false\**: The server has explicitly signaled that no further records exist in the current query direction.
2. **\meta.nextCursor === null\ or \undefined\**: No further pagination token exists.
3. **\data.length === 0\**: The record array is empty.
4. **\data.length < requestedLimit\**: When the records returned are fewer than the requested page size, the end of the dataset has been reached.

### Edge Case: Exact Multiple Boundaries
When the total record count matches an exact multiple of \limit\ (e.g. exactly 400 records with \limit=200\), the second page returns 200 items. Depending on network timing, \hasMore\ might still indicate \	rue\. The subsequent fetch will return \data.length === 0\ and \hasMore: false\. Your ingestion loop must gracefully break when \data.length === 0\ without failing.

---

## Recommended Page Sizes by Use Case

Choosing the correct \limit\ balances network round-trip overhead against memory footprint and serialization costs:

| Use Case | Recommended \limit\ | Rationale |
| :--- | :---: | :--- |
| **Interactive Web UI / Mobile Tables** | \10\ - \25\ | Minimizes initial render latency and payload size. |
| **Mobile Infinite Scroll** | \20\ - \50\ | Balances smooth 60fps scrolling with minimal memory pressure. |
| **Historical Ingestion / ETL Pipelines** | \100\ - \200\ | Maximizes throughput by minimizing HTTP round-trip latency. \200\ is the maximum allowed batch size supported by Horizon. |
| **High-Frequency Ledger Auditing** | \50\ - \100\ | Reduces payload buffering when processing complex multi-operation transactions. |

---

## Parallel Pagination Across Multiple Accounts

When ingesting transactions across multiple accounts (e.g. institutional treasury or exchange wallets), do **not** run unbounded concurrent requests. Horizon rate limits will be triggered (\429 Too Many Requests\).

### Concurrency Best Practices
1. **Per-Account Independent Cursor Tracking**: Maintain a stateful cursor record per account address.
2. **Concurrency Limiting**: Limit simultaneous account sync workers using a concurrency pool (e.g., 3-5 concurrent workers).
3. **Dedicated Ingestion Queues**: Use worker queues (BullMQ, Celery, or SQS) with rate-limiting backpressure.

---

## Complete Node.js Example: Streaming Account Transactions

The following complete, production-ready script demonstrates:
- Sequential pagination using an \sync generator\ (\streamAccountTransactions\)
- Automatic cursor resumption from any saved token
- Backoff handling on rate limits (\429\)
- Automatic terminal detection (\hasMore\ and \
extCursor\)

\\\javascript
/**
 * pagination-stream-example.js
 * 
 * Complete Node.js example streaming all transactions for a Stellar account
 * with cursor resumption and rate-limit backoff.
 */

const BASE_URL = process.env.STELLAR_API_URL || 'http://localhost:3000';

/**
 * Sleep helper for rate-limit exponential backoff
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Async generator that yields transaction records page by page.
 *
 * @param {string} accountId - 56-character Stellar public key (G...)
 * @param {object} options
 * @param {string} [options.initialCursor] - Optional cursor to resume from
 * @param {number} [options.limit=200]     - Batch size (max 200)
 * @param {string} [options.order='asc']    - 'asc' for ETL pipelines, 'desc' for latest
 * @param {number} [options.maxRetries=5]   - Max retry attempts on 429 / 5xx
 * @yields {object} Individual transaction record
 */
async function* streamAccountTransactions(accountId, options = {}) {
  const {
    initialCursor = undefined,
    limit = 200,
    order = 'asc',
    maxRetries = 5,
  } = options;

  let currentCursor = initialCursor;
  let hasMore = true;
  let totalProcessed = 0;

  while (hasMore) {
    const url = new URL(\\/account/\/payments\);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('order', order);
    if (currentCursor) {
      url.searchParams.set('cursor', currentCursor);
    }

    let responseData = null;
    let attempt = 0;

    // Retry loop with exponential backoff
    while (attempt < maxRetries) {
      try {
        const response = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
        });

        if (response.status === 429) {
          const retryAfterSec = response.headers.get('retry-after');
          const waitTime = retryAfterSec ? parseInt(retryAfterSec, 10) * 1000 : Math.pow(2, attempt) * 1000;
          console.warn(\[RateLimit] 429 received. Backing off for \ms...\);
          await sleep(waitTime);
          attempt++;
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(\HTTP \: \\);
        }

        responseData = await response.json();
        break;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new Error(\Failed to fetch page after \ attempts: \\);
        }
        const backoffMs = Math.pow(2, attempt) * 500;
        await sleep(backoffMs);
      }
    }

    const records = responseData?.data || [];
    const meta = responseData?.meta || {};

    if (records.length === 0) {
      break;
    }

    for (const record of records) {
      yield {
        record,
        cursor: record.paging_token || meta.nextCursor,
        totalProcessed: ++totalProcessed,
      };
    }

    currentCursor = meta.nextCursor;
    hasMore = Boolean(meta.hasMore) && Boolean(currentCursor) && records.length === limit;
  }
}

// --------------------------------------------------------------------------
// Example Consumption Usage
// --------------------------------------------------------------------------
async function runIngestionPipeline() {
  const TARGET_ACCOUNT = 'GBBD47R2LWK7P7CQA4B27USF672QHWWT7MQFGCVQD6ISVJVCGLOWW657';
  let checkpointCursor = null; 

  console.log(\Starting ingestion for account: \\);
  console.log(\Resuming from cursor: \\);

  try {
    for await (const { record, cursor, totalProcessed } of streamAccountTransactions(TARGET_ACCOUNT, {
      initialCursor: checkpointCursor,
      limit: 200,
      order: 'asc',
    })) {
      checkpointCursor = cursor;

      if (totalProcessed % 500 === 0) {
        console.log(\[Progress] Processed \ transactions. Checkpoint: \\);
      }
    }

    console.log(\[Complete] Stream finished. Last checkpoint: \\);
  } catch (error) {
    console.error(\[Fatal Pipeline Error]:\, error.message);
    console.log(\[Recovery] Resume later using checkpointCursor: \\);
  }
}

if (require.main === module) {
  runIngestionPipeline();
}

module.exports = { streamAccountTransactions };
\\\

---

## Error Recovery & Rate Limit Backoff

When handling continuous pagination across large history datasets:

1. **HTTP 429 (Too Many Requests)**:
   - Check \headers.get('retry-after')\ or \headers.get('ratelimit-reset')\.
   - Apply jittered exponential backoff: \Math.min(10000, (2 ** attempt * 500) + Math.random() * 200)\.
2. **Invalid Cursor (HTTP 400)**:
   - If Horizon prunes older history ledgers or a malformed token is provided, the API returns \InvalidCursor\.
   - Catch \InvalidCursor\, log an alert, and fall back to querying by ledger sequence or \page=1\.

---

## Related Guides

- [Basic Pagination Guide](pagination.md) — Core limit and cursor parameters reference
- [Response Format Guide](response-format.md) — Standard envelope schemas and \meta\ fields
- [API Design Guidelines](api-design.md) — Query conventions and filtering rules
- [Rate Limiting Strategies](rate-limiting-strategies.md) — Managing quotas in high-throughput applications
- [Streaming Guide](streaming.md) — Real-time event streaming via SSE and WebSockets
