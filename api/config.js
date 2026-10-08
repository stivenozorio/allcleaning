// Configuración PÚBLICA para el navegador (URL y publishable key de Supabase).
// Nunca incluir aquí SUPABASE_SECRET_KEY ni tokens de Meta.
import { whatsappConfigured } from "./_lib/whatsapp.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  res.status(200).json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || null,
    whatsappConfigured: whatsappConfigured()
  });
}
