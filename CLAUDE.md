# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **dsvspace** (Doriancoin Space), a fork of the Mempool open-source project adapted for Doriancoin. It's a mempool visualizer and blockchain explorer running at blocks.doriancoin.com.

The codebase is derived from Litecoin Space (itself a fork of mempool.space for Bitcoin), modified to work with the Doriancoin network.

## Build and Development Commands

### Prerequisites
- Node.js v16.16.0 (see `.nvmrc`)
- npm 7+
- MariaDB 10.5+ for the backend database

### Backend

```bash
cd backend
npm install
npm run build          # Compile TypeScript to dist/
npm run start          # Run the backend (uses 2GB heap)
npm run start-production  # Run with 16GB heap for production

# Development
npm run lint           # ESLint check
npm run lint:fix       # ESLint auto-fix
npm run test           # Run Jest tests with coverage

# Config: Copy mempool-config.sample.json to mempool-config.json
```

### Frontend

```bash
cd frontend
npm install
npm run start          # Dev server at localhost:4200 (proxies to local backend)
npm run serve:local-prod  # Dev server proxying to production backend
npm run build          # Production build with i18n

# Testing
npm run cypress:open   # Interactive Cypress tests
npm run cypress:run    # Headless Cypress tests
npm run lint           # ESLint check
```

### Unfurler (Open Graph previews)

```bash
cd unfurler
npm install
npm run build
npm run start
```

### Docker

```bash
cd docker
docker-compose up
```

## Architecture

### Three-Service Architecture

1. **Backend** (`backend/`) - Node.js/TypeScript Express server
   - Connects to Doriancoin Core via RPC (port 1948)
   - Optional Electrum server connection for address lookups
   - MariaDB for persistent storage (mempool stats, blocks, mining pools)
   - WebSocket server for real-time updates to frontend
   - Main entry: `src/index.ts`

2. **Frontend** (`frontend/`) - Angular 14 SPA
   - Mempool visualization, block explorer, transaction details
   - Real-time updates via WebSocket
   - Internationalization support (see `src/locale/`)
   - Charts via ECharts (`ngx-echarts`)
   - Main module: `src/app/app.module.ts`

3. **Unfurler** (`unfurler/`) - Social media link preview service
   - Puppeteer-based screenshot generation
   - Open Graph meta tag serving for social media bots

### Backend Key Modules

- `src/api/` - API endpoints and core logic
  - `blocks.ts` - Block processing and indexing
  - `mempool.ts` - Mempool state management
  - `websocket-handler.ts` - Real-time client updates
  - `database-migration.ts` - Schema migrations
- `src/repositories/` - Database access layer
- `src/rpc-api/` - Doriancoin Core RPC client

### Configuration

Backend config lives in `backend/mempool-config.json` (copy from `mempool-config.sample.json`). Key settings:
- `MEMPOOL.NETWORK` - "mainnet" or "testnet"
- `MEMPOOL.BACKEND` - "electrum", "esplora", or "none"
- `CORE_RPC` - Doriancoin Core connection (default port 1948)
- `DATABASE` - MariaDB connection

Frontend config generated via `npm run generate-config` from `mempool-frontend-config.sample.json`.

## Testing

### Backend Tests
```bash
cd backend
npm run test                    # All tests with coverage
npx jest path/to/test.spec.ts   # Single test file
```

### Frontend E2E Tests
```bash
cd frontend
npm run cypress:run             # Headless
npm run cypress:open            # Interactive
```

## Doriancoin-Specific Notes

- RPC port 1948 (vs Litecoin's 9332)
- Mining pools config: `MEMPOOL.POOLS_JSON_URL` setting
- Block weight units: 4,000,000 (standard SegWit)
