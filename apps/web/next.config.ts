import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@novi/core', '@novi/db', '@novi/pipeline', '@novi/assist'],
  // better-sqlite3 est natif ; unpdf embarque pdf.js et le SDK Anthropic est importé dynamiquement :
  // aucun des trois ne doit passer par le bundler.
  serverExternalPackages: ['better-sqlite3', 'unpdf', '@anthropic-ai/sdk'],
  agentRules: false,
};

export default nextConfig;
