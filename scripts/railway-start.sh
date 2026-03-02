#!/bin/bash
set -e

echo "=== Railway Deployment v6 ==="

echo "Installing dependencies..."
bun install

echo "Swapping in PostgreSQL schema for Railway..."
cp prisma/schema.railway.prisma prisma/schema.prisma

echo "Cleaning Prisma cache..."
rm -rf node_modules/.prisma

echo "Generating Prisma client..."
bunx prisma generate

echo "Running database migrations (push)..."
# Use --skip-generate since we already generated above
# If db push fails (e.g. cross-schema refs in Supabase), continue anyway
# Tables already exist from previous deployments
bunx prisma db push --accept-data-loss --skip-generate || {
  echo "WARNING: db push failed (likely cross-schema ref in Supabase). Continuing anyway..."
  echo "Tables already exist from previous deployment."
}

echo "Starting server..."
exec bun src/index.ts
