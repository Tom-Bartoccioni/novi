import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novi/core', '@novi/db', '@novi/pipeline'],
  serverExternalPackages: ['better-sqlite3'],
  agentRules: false,
};

export default nextConfig;
