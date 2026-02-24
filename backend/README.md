# StellarStream Backend

Backend service for indexing and serving Stellar payment stream data.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Production

```bash
npm start
```

## Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled production build
- `npm run lint` - Run ESLint type checking
- `npm run type-check` - Run TypeScript compiler without emitting files

## Directory Structure

```
/src
  /api        - REST API routes and controllers
  /indexer    - Stellar blockchain indexer
  /services   - Business logic layer
  /types      - TypeScript type definitions
```
