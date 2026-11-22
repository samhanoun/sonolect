import {
  createClient,
  type SupabaseClient,
  type User,
  type Session,
} from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * The Supabase client, made on first use. A build without the two
 * VITE_SUPABASE_ values loads this module without an error; only signing in
 * or a team call then fails, and says why.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env?.VITE_SUPABASE_URL ?? "";
  const key = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? "";
  if (!url || !key)
    throw new Error(
      "Team sign-in is not set up: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing.",
    );
  client = createClient(url, key);
  return client;
}

export type AuthState = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
};

export function createInitialAuthState(): AuthState {
  return { user: null, session: null, loading: true, error: null };
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthState> {
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email,
    password,
  });
  if (error)
    return { user: null, session: null, loading: false, error: error.message };
  return {
    user: data.user,
    session: data.session,
    loading: false,
    error: null,
  };
}

export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthState> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { full_name: displayName } },
  });
  if (error)
    return { user: null, session: null, loading: false, error: error.message };
  return {
    user: data.user,
    session: data.session,
    loading: false,
    error: null,
  };
}

export async function signInWithOAuth(
  provider: "google" | "github" | "apple",
): Promise<void> {
  await getSupabase().auth.signInWithOAuth({ provider });
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

export async function getSession(): Promise<AuthState> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error)
    return { user: null, session: null, loading: false, error: error.message };
  return {
    user: data.session?.user ?? null,
    session: data.session,
    loading: false,
    error: null,
  };
}

export function onAuthStateChange(
  callback: (state: AuthState) => void,
): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
    callback({
      user: session?.user ?? null,
      session,
      loading: false,
      error: null,
    });
  });
  return () => data.subscription.unsubscribe();
}
