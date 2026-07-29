import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testUpdateInsertPattern() {
  const { data: courses } = await supabase.from('courses').select('id, title').limit(1);
  const validCourseId = courses[0].id;

  const testEmail = `pattern_test_${Date.now()}@gmail.com`;
  const { data: signUpData } = await supabase.auth.signUp({
    email: testEmail,
    password: 'Password123!',
  });
  const userId = signUpData.user.id;

  console.log('Testing Safe Update + Insert Pattern...');

  const now = new Date().toISOString();

  // Step 1: Try update existing row
  const { data: updateData, error: updateErr } = await supabase
    .from('enrollments')
    .update({ completed_at: now })
    .eq('user_id', userId)
    .eq('course_id', validCourseId)
    .select();

  console.log('Update result:', { updateData, updateErr });

  // Step 2: If no existing row updated, insert new enrollment row
  if (!updateErr && (!updateData || updateData.length === 0)) {
    const { data: insertData, error: insertErr } = await supabase
      .from('enrollments')
      .insert({
        user_id: userId,
        course_id: validCourseId,
        payment_status: 'completed',
        completed_at: now,
      })
      .select();

    console.log('Insert result:', { insertData, insertErr });
  }

  // Step 3: Re-run update on existing row to verify RLS allows updating completed_at
  const updatedTime = new Date().toISOString();
  const { data: secondUpdateData, error: secondUpdateErr } = await supabase
    .from('enrollments')
    .update({ completed_at: updatedTime })
    .eq('user_id', userId)
    .eq('course_id', validCourseId)
    .select();

  console.log('Second update result (verifying RLS on existing row):', { secondUpdateData, secondUpdateErr });
  if (!secondUpdateErr && secondUpdateData?.length > 0) {
    console.log('SUCCESS! Update + Insert pattern works 100% cleanly without RLS or ON CONFLICT errors!');
  }
}

testUpdateInsertPattern();
