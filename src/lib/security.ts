/**
 * Security Utilities
 *
 * Centralized security functions for authentication, authorization,
 * and audit logging.
 */

import crypto from 'crypto';
import prisma from './prisma';

// ============================================================================
// TYPES
// ============================================================================

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'reader' | 'agent' | 'admin';
  tier: string;
  agentVerificationStatus?: string;
}

export interface AuditLogEntry {
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

// ============================================================================
// SESSION TOKEN MANAGEMENT
// ============================================================================

// Simple in-memory session store (should use Redis in production)
const sessionStore = new Map<string, { userId: string; createdAt: Date; expiresAt: Date }>();

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a session for a user
 * @returns Session token
 */
export async function createSession(userId: string, durationHours: number = 24): Promise<string> {
  const token = generateSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  sessionStore.set(token, {
    userId,
    createdAt: now,
    expiresAt,
  });

  // Clean up expired sessions periodically
  cleanupExpiredSessions();

  return token;
}

/**
 * Validate a session token and return the user
 */
export async function validateSession(token: string): Promise<AuthenticatedUser | null> {
  const session = sessionStore.get(token);

  if (!session) {
    return null;
  }

  // Check expiration
  if (new Date() > session.expiresAt) {
    sessionStore.delete(token);
    return null;
  }

  // Fetch user from database
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      role: true,
      tier: true,
      agent_verification_status: true,
    },
  });

  if (!user) {
    sessionStore.delete(token);
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.role as 'reader' | 'agent' | 'admin',
    tier: user.tier,
    agentVerificationStatus: user.agent_verification_status,
  };
}

/**
 * Invalidate a session (logout)
 */
export function invalidateSession(token: string): void {
  sessionStore.delete(token);
}

/**
 * Invalidate all sessions for a user
 */
export function invalidateAllUserSessions(userId: string): void {
  for (const [token, session] of sessionStore.entries()) {
    if (session.userId === userId) {
      sessionStore.delete(token);
    }
  }
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = new Date();
  for (const [token, session] of sessionStore.entries()) {
    if (now > session.expiresAt) {
      sessionStore.delete(token);
    }
  }
}

// ============================================================================
// REQUEST AUTHENTICATION
// ============================================================================

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) return null;
  return match[1];
}

/**
 * Authenticate user by email (for backward compatibility during migration)
 * WARNING: This should be phased out in favor of session-based auth
 */
export async function authenticateByEmail(email: string): Promise<AuthenticatedUser | null> {
  if (!email) return null;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      role: true,
      tier: true,
      agent_verification_status: true,
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    role: user.role as 'reader' | 'agent' | 'admin',
    tier: user.tier,
    agentVerificationStatus: user.agent_verification_status,
  };
}

// ============================================================================
// AUTHORIZATION CHECKS
// ============================================================================

/**
 * Check if user is an approved agent
 */
export function isApprovedAgent(user: AuthenticatedUser): boolean {
  return (
    (user.role === 'agent' && user.agentVerificationStatus === 'approved') ||
    user.role === 'admin'
  );
}

/**
 * Check if user has admin privileges
 */
export function isAdmin(user: AuthenticatedUser): boolean {
  return user.role === 'admin';
}

/**
 * Check if user can submit listings
 */
export function canSubmitListings(user: AuthenticatedUser): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'agent') return false;
  if (user.agentVerificationStatus !== 'approved') return false;
  return user.tier === 'agent' || user.tier === 'elite';
}

/**
 * Check if user can submit articles
 */
export function canSubmitArticles(user: AuthenticatedUser): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'agent') return false;
  if (user.agentVerificationStatus !== 'approved') return false;
  return true; // Any approved agent can submit articles
}

// ============================================================================
// WEBHOOK VERIFICATION
// ============================================================================

/**
 * Verify RevenueCat webhook signature using HMAC
 */
export function verifyRevenueCatWebhook(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/**
 * Verify generic webhook with bearer token
 */
export function verifyWebhookAuth(
  authHeader: string | undefined,
  expectedSecret: string
): boolean {
  if (!expectedSecret) {
    console.error('[Security] Webhook secret not configured!');
    return false;
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return false;
  }

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expectedSecret)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/**
 * Log a security-relevant action
 */
export async function auditLog(entry: AuditLogEntry): Promise<void> {
  // Log to console for now (should go to dedicated audit database in production)
  const timestamp = new Date().toISOString();
  const logLevel = entry.success ? 'INFO' : 'WARN';

  console.log(
    `[AUDIT][${logLevel}][${timestamp}] ` +
    `user=${entry.userId || 'anonymous'} ` +
    `action=${entry.action} ` +
    `resource=${entry.resource} ` +
    `resourceId=${entry.resourceId || 'N/A'} ` +
    `success=${entry.success} ` +
    `ip=${entry.ipAddress || 'unknown'} ` +
    (entry.errorMessage ? `error="${entry.errorMessage}"` : '')
  );

  // Store in database for compliance (optional - enable in production)
  // await prisma.auditLog.create({ data: { ...entry, timestamp } });
}

/**
 * Get client IP address from request headers
 */
export function getClientIP(headers: {
  get: (name: string) => string | undefined;
}): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// ============================================================================
// INPUT SANITIZATION
// ============================================================================

/**
 * Sanitize email input
 */
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Sanitize string input (prevent XSS)
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove angle brackets
    .slice(0, 10000); // Limit length
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// ============================================================================
// RATE LIMITING HELPERS
// ============================================================================

// Per-user rate limit tracking (in-memory, should use Redis in production)
const userRateLimits = new Map<string, { count: number; resetAt: Date }>();

/**
 * Check user-specific rate limit
 */
export function checkUserRateLimit(
  userId: string,
  action: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: Date } {
  const key = `${userId}:${action}`;
  const now = new Date();

  const existing = userRateLimits.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = new Date(now.getTime() + windowMs);
    userRateLimits.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return { allowed: true, remaining: maxRequests - existing.count, resetAt: existing.resetAt };
}

// ============================================================================
// IDEMPOTENCY
// ============================================================================

// Track processed webhook/transaction IDs
const processedTransactions = new Map<string, Date>();

/**
 * Check if a transaction has already been processed (idempotency)
 */
export function isTransactionProcessed(transactionId: string): boolean {
  return processedTransactions.has(transactionId);
}

/**
 * Mark a transaction as processed
 */
export function markTransactionProcessed(transactionId: string): void {
  processedTransactions.set(transactionId, new Date());

  // Clean up old entries (keep last 24 hours)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [id, date] of processedTransactions.entries()) {
    if (date < cutoff) {
      processedTransactions.delete(id);
    }
  }
}