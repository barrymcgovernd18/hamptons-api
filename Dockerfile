FROM oven/bun:1.2.10-debian

WORKDIR /app

# Install OpenSSL 3.0
RUN apt-get update && apt-get install -y openssl libssl3 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies (no lockfile - fresh install for Railway)
RUN bun install

# Copy source code
COPY . .

# Copy Railway-specific Prisma schema
RUN cp prisma/schema.railway.prisma prisma/schema.prisma

# Set dummy DATABASE_URL for Prisma client generation (real URL provided at runtime)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Generate Prisma client
RUN bunx prisma generate

# Expose port
EXPOSE 8080

# Start command - try migrations (non-fatal if cross-schema error), then start server
CMD bash -c '(bunx prisma db push --accept-data-loss --skip-generate 2>&1 || echo "db push warning - tables already exist") && exec bun src/index.ts'