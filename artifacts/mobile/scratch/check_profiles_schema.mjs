import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkRealSchema() {
  console.log('Testing columns on profiles table...');
  const testCols = ['id', 'full_name', 'username', 'avatar_url', 'email', 'created_at', 'role', 'points', 'xp'];
  
  for (const col of testCols) {
    const { error } = await supabase.from('profiles').select(col).limit(1);
    if (!error) {
      console.log(`  [EXISTS] profiles.${col}`);
    } else {
      console.log(`  [MISSING] profiles.${col} (${error.message})`);
    }
  }

  console.log('\nTesting lesson_progress table counts for leaderboard...');
  const { data: progress, error: progErr } = await supabase
    .from('lesson_progress')
    .select('user_id, is_completed');
  
  if (!progErr && progress) {
    console.log(`Total lesson_progress records: ${progress.length}`);
    const userCounts = new Map();
    progress.forEach((p) => {
      if (p.is_completed) {
        userCounts.set(p.user_id, (userCounts.get(p.user_id) || 0) + 1);
      }
    });
    console.log('User completed lesson counts:', Array.from(userCounts.entries()));
  } else {
    console.log('lesson_progress error:', progErr);
  }
}

checkRealSchema();
