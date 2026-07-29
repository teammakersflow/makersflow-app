import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://oodqutwsljhvuyotuthu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vZHF1dHdzbGpodnV5b3R1dGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1Mjk3MDYsImV4cCI6MjA5NzEwNTcwNn0.XgxUO7bUC24GFziKvZCawVgUKRjxC7OGzSdu1aN3xL0';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkRankingMetrics() {
  console.log('--- TESTING REAL LEADERBOARD METRICS ---');

  // Option 1: streaks table query
  const { data: streakData, error: streakErr } = await supabase
    .from('streaks')
    .select('user_id, current_streak, longest_streak')
    .order('current_streak', { ascending: false })
    .limit(10);

  if (!streakErr && streakData) {
    console.log('OPTION 1: streaks table result:', streakData);
  } else {
    console.log('Option 1 streaks error:', streakErr?.message);
  }

  // Option 2: enrollments table completed_at count
  const { data: enrollData, error: enrollErr } = await supabase
    .from('enrollments')
    .select('user_id, completed_at, courses(title)')
    .not('completed_at', 'is', null);

  if (!enrollErr && enrollData) {
    console.log(`OPTION 2: enrollments with completed_at records count: ${enrollData.length}`);
    const userCompletedMap = new Map();
    enrollData.forEach((e) => {
      userCompletedMap.set(e.user_id, (userCompletedMap.get(e.user_id) || 0) + 1);
    });
    console.log('User completed courses counts:', Array.from(userCompletedMap.entries()));
  } else {
    console.log('Option 2 enrollments error:', enrollErr?.message);
  }

  // Option 3: lesson_progress completed count
  const { data: progData, error: progErr } = await supabase
    .from('lesson_progress')
    .select('user_id, is_completed')
    .eq('is_completed', true);

  if (!progErr && progData) {
    console.log(`OPTION 3: lesson_progress completed records count: ${progData.length}`);
    const userLessonsMap = new Map();
    progData.forEach((p) => {
      userLessonsMap.set(p.user_id, (userLessonsMap.get(p.user_id) || 0) + 1);
    });
    console.log('User completed lessons counts:', Array.from(userLessonsMap.entries()));
  } else {
    console.log('Option 3 lesson_progress error:', progErr?.message);
  }
}

checkRankingMetrics();
