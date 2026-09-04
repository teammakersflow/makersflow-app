import type { User as DomainUser } from '@/context/AuthContext';
import type { AuthUserResponse } from '@/lib/auth/customAuthService';

// Database types for authentication and user profiles
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  grade?: string | null;
  school?: string | null;
  avatar_url?: string | null;
  age?: number | null;
  phone?: string | null;
  onboarding_completed?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;
      };
    };
  };
}

/**
 * Mapper helper converting backend AuthUserResponse into internal User domain model.
 */
export function mapBackendUserToDomain(
  dto: AuthUserResponse,
  profile?: Partial<Profile> | null
): DomainUser {
  return {
    id: dto.id,
    email: dto.email,
    name: dto.name || (dto.full_name as string) || profile?.full_name || dto.email.split('@')[0] || 'User',
    avatar: dto.profileImage || (dto.avatar_url as string) || profile?.avatar_url || undefined,
    role: dto.role || profile?.role || 'student',
    phone: (dto.phone as string) || profile?.phone || undefined,
    grade: (dto.grade as string) || profile?.grade || undefined,
    school: (dto.school as string) || profile?.school || undefined,
    age: (dto.age as number) || profile?.age || undefined,
    joinedDate: profile?.created_at
      ? new Date(profile.created_at).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        })
      : new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    onboarding_completed: (dto.onboarding_completed as boolean) || profile?.onboarding_completed || false,
  };
}
