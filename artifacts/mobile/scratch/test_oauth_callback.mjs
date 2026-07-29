import fetch from 'node-fetch';

async function testOAuthFlow() {
  console.log('--- TESTING OAUTH AUTHORIZE REDIRECT RESPONSE ---');
  const authorizeUrl = 'https://oodqutwsljhvuyotuthu.supabase.co/auth/v1/authorize?provider=google&redirect_to=makersflow%3A%2F%2Fauth%2Fcallback';
  
  const res = await fetch(authorizeUrl, { redirect: 'manual' });
  console.log('Authorize Endpoint HTTP Status:', res.status);
  console.log('Authorize Endpoint Location Header:', res.headers.get('location'));
}

testOAuthFlow();
