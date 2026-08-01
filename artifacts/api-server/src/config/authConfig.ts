import dotenv from 'dotenv';

dotenv.config();

export interface AuthConfig {
  port: number;
  jwtSecret: string;
  jwtRefreshSecret: string;
  googleClientId: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}

let cachedConfig: AuthConfig | null = null;

/**
 * Validates and returns the backend environment configuration.
 * Crashes server initialization immediately if any required variable is missing.
 */
export function loadAndValidateConfig(): AuthConfig {
  if (cachedConfig) return cachedConfig;

  const jwtSecret = process.env.JWT_SECRET;
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!jwtSecret) missing.push('JWT_SECRET');
  if (!jwtRefreshSecret) missing.push('JWT_REFRESH_SECRET');
  if (!googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length > 0) {
    const errorMsg = `CRITICAL CONFIGURATION ERROR: Missing required environment variables: ${missing.join(', ')}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  cachedConfig = {
    port: Number(process.env.PORT) || 3001,
    jwtSecret: jwtSecret!,
    jwtRefreshSecret: jwtRefreshSecret!,
    googleClientId: googleClientId!,
    accessTokenExpiresIn: Number(process.env.ACCESS_TOKEN_EXPIRES_IN) || 900,
    refreshTokenExpiresIn: Number(process.env.REFRESH_TOKEN_EXPIRES_IN) || 604800,
    supabaseUrl: supabaseUrl!,
    supabaseServiceRoleKey: supabaseServiceRoleKey!,
  };

  return cachedConfig;
}
