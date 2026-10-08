import { createClient } from "@supabase/supabase-js";

let adminClient = null;

export function getAdmin() {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      throw new Error(
        "Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SECRET_KEY"
      );
    }

    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  return adminClient;
}

// Valida el access token de Supabase Auth enviado por el navegador.
export async function requireUser(req) {
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return null;

  const { data, error } = await getAdmin().auth.getUser(token);

  if (error || !data?.user) return null;

  return data.user;
}
