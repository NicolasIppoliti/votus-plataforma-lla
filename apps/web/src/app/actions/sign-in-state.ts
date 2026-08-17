export interface SignInState {
  error: string | null;
}

export const INITIAL_SIGN_IN_STATE: SignInState = {
  error: null,
};

export const GENERIC_SIGN_IN_ERROR: SignInState = {
  error: "Las credenciales no son válidas.",
};
