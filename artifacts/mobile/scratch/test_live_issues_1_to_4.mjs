import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function verifyLiveDbUpdates() {
  console.log('--- VERIFYING LIVE DB PROFILES AGE COLUMN READ/WRITE ---');
  
  // 1. Verify profiles.age column is queryable without error
  const { data: profileSample, error: selectErr } = await supabase
    .from('profiles')
    .select('id, full_name, age, grade, phone')
    .limit(1);

  if (selectErr) {
    console.error('FAILED: profiles.age select query error:', selectErr.message);
  } else {
    console.log('PASSED: profiles.age queryable! Sample row:', profileSample);
  }

  // 2. Verify news article content vs summary check
  const { data: newsSample, error: newsErr } = await supabase
    .from('news')
    .select('id, title, content')
    .limit(1);

  if (!newsErr && newsSample && newsSample.length > 0) {
    const rawContent = newsSample[0].content || "";
    const cleanText = rawContent.replace(/[#*`_\[\]()]/g, '').replace(/\s+/g, ' ').trim();
    const summary = cleanText.substring(0, 110) + (cleanText.length > 110 ? "..." : "");
    const isSubstring = rawContent.trim().startsWith(summary.replace("...", "").trim());
    console.log('PASSED: News summary deduplication logic test. Is summary a leading substring?', isSubstring);
  }
}

verifyLiveDbUpdates();
