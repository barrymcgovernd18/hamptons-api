#!/bin/bash
set -e

echo "=== Railway Deployment v5 ==="

echo "Installing dependencies..."
bun install

echo "Swapping in PostgreSQL schema for Railway..."
cp prisma/schema.railway.prisma prisma/schema.prisma

echo "Cleaning Prisma cache..."
rm -rf node_modules/.prisma

echo "Generating Prisma client..."
bunx prisma generate

echo "Running database migrations (push)..."
bunx prisma db push --accept-data-loss

echo "Starting server..."
exec bun src/index.ts