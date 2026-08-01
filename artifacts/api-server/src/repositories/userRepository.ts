import { getSupabaseAdmin } from '../lib/supabaseAdmin';

export interface UserRecord {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  avatar_url?: string | null;
  grade?: string | null;
  school?: string | null;
  created_at: string;
  updated_at?: string;
}

export const userRepository = {
  async findByGoogleSubjectId(googleSub: string): Promise<UserRecord | null> {
    const supabase = getSupabaseAdmin();
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('google_sub', googleSub)
        .maybeSingle();

      if (!error && data) return data as UserRecord;
    } catch {
      // Column may not exist in existing table schema
    }
    return null;
  },

  async findByEmail(email: string): Promise<UserRecord | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('[UserRepository] findByEmail warning:', error.message);
    }
    return (data as UserRecord) || null;
  },

  async findById(id: string): Promise<UserRecord | null> {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.warn('[UserRepository] findById warning:', error.message);
    }
    return (data as UserRecord) || null;
  },

  async createUser(data: {
    email: string;
    fullName?: string;
    avatarUrl?: string;
    googleSub?: string;
    role?: string;
  }): Promise<UserRecord> {
    const supabase = getSupabaseAdmin();
    const normalizedEmail = data.email.trim().toLowerCase();

    // Check if profile already exists for this email
    const existingProfile = await this.findByEmail(normalizedEmail);
    if (existingProfile) return existingProfile;

    // Create user via Supabase Auth Admin to satisfy profiles_id_fkey foreign key
    let userId: string;
    const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName,
        name: data.fullName,
        avatar_url: data.avatarUrl,
      },
    });

    if (authErr || !authUser?.user) {
      const existing = await this.findByEmail(normalizedEmail);
      if (existing) return existing;
      throw new Error(`Failed to create user in authentication store: ${authErr?.message || 'Unknown error'}`);
    }

    userId = authUser.user.id;
    const now = new Date().toISOString();

    const record: any = {
      id: userId,
      email: normalizedEmail,
      full_name: data.fullName || null,
      avatar_url: data.avatarUrl || null,
      role: data.role || 'student',
      created_at: now,
    };

    const { data: created, error } = await supabase
      .from('profiles')
      .upsert(record, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (error || !created) {
      return {
        id: userId,
        email: normalizedEmail,
        full_name: data.fullName || null,
        avatar_url: data.avatarUrl || null,
        role: data.role || 'student',
        created_at: now,
      };
    }

    return created as UserRecord;
  },

  async linkGoogleSubjectId(userId: string, googleSub: string, updates?: { fullName?: string; avatarUrl?: string }): Promise<UserRecord> {
    const supabase = getSupabaseAdmin();
    const payload: any = {};
    if (updates?.fullName) payload.full_name = updates.fullName;
    if (updates?.avatarUrl) payload.avatar_url = updates.avatarUrl;

    if (Object.keys(payload).length === 0) {
      const existing = await this.findById(userId);
      if (existing) return existing;
    }

    const { data: updated, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (error || !updated) {
      const existing = await this.findById(userId);
      if (existing) return existing;
      throw new Error(`Failed to update profile record: ${error?.message}`);
    }

    return updated as UserRecord;
  },
};
