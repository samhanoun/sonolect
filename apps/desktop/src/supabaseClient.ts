import {
  createClient,
  type SupabaseClient,
  type User,
  type Session,
} from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://ezdmdafdcuvrjeohnqur.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6ZG1kYWZkY3V2cmplb2hucXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyODU4MzUsImV4cCI6MjA5Mzg2MTgzNX0.0Hi8bxNw3EMXjByDkiKFXT8bLvX_S36LGDTqSlUX2zA";

export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
);

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
  const { data, error } = await supabase.auth.signInWithPassword({
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
  const { data, error } = await supabase.auth.signUp({
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
  await supabase.auth.signInWithOAuth({ provider });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getSession(): Promise<AuthState> {
  const { data, error } = await supabase.auth.getSession();
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
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback({
      user: session?.user ?? null,
      session,
      loading: false,
      error: null,
    });
  });
  return () => data.subscription.unsubscribe();
}
