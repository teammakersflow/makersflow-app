export interface AuthProfile {
  providerSubjectId: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface IAuthProvider {
  readonly providerName: string;
  verifyToken(tokenString: string): Promise<AuthProfile>;
}
