import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testPasswordResetRedirect() {
  console.log('--- TESTING PASSWORD RESET REDIRECT TO VALUE ---');
  const targetRedirect = 'makersflow://reset-password';
  console.log('Mobile passes redirectTo:', targetRedirect);
  
  // Call resetPasswordForEmail with targetRedirect
  const { data, error } = await supabase.auth.resetPasswordForEmail('test_verify_redirect@example.com', {
    redirectTo: targetRedirect
  });

  if (error) {
    console.error('Password reset call error:', error.message);
  } else {
    console.log('Password reset request initiated successfully. Supabase accepted redirectTo:', targetRedirect);
  }
}

async function testGoogleOAuthRedirect() {
  console.log('--- TESTING GOOGLE OAUTH REDIRECT URL ---');
  const targetRedirect = 'makersflow://auth/callback';
  console.log('Mobile passes OAuth redirectTo:', targetRedirect);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: targetRedirect,
      skipBrowserRedirect: true
    }
  });

  if (error) {
    console.error('OAuth initiation error:', error.message);
  } else if (data?.url) {
    console.log('OAuth initiation URL returned:', data.url);
    const parsed = new URL(data.url);
    console.log('OAuth redirect_uri parameter in returned auth URL:', parsed.searchParams.get('redirect_uri'));
  }
}

async function main() {
  await testPasswordResetRedirect();
  await testGoogleOAuthRedirect();
}

main();
