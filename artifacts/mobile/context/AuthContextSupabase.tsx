/**
 * Backward compatibility bridge for legacy AuthContextSupabase imports.
 * Routes all authentication requests directly through the canonical backend AuthContext.
 */
import { AuthProvider, useAuth, User, AuthContextType, buildUser } from './AuthContext';

export { AuthProvider, useAuth, User, AuthContextType, buildUser };
export default AuthProvider;
