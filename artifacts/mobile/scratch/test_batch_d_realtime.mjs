import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testRapidAnnouncementPublish() {
  console.log('--- TESTING RAPID ANNOUNCEMENT INSERT + UPDATE ---');
  
  const testTitle = `Test Announcement ${Date.now()}`;
  
  // 1. Insert announcement with published status
  const { data: inserted, error: insertErr } = await supabase
    .from('announcements')
    .insert({
      title: testTitle,
      message: 'Testing realtime notification deduplication live on emulator',
      type: 'announcement',
      status: 'published',
    })
    .select();

  if (insertErr || !inserted || inserted.length === 0) {
    console.error('Insert error:', insertErr);
    return;
  }

  const annId = inserted[0].id;
  console.log('1. INSERTED announcement:', annId);

  // 2. Immediately update announcement (simulating admin panel post-insert trigger / update)
  const { data: updated, error: updateErr } = await supabase
    .from('announcements')
    .update({ message: 'Updated message trigger' })
    .eq('id', annId)
    .select();

  if (updateErr) {
    console.error('Update error:', updateErr);
  } else {
    console.log('2. UPDATED announcement immediately after insert:', annId);
  }
}

testRapidAnnouncementPublish();
