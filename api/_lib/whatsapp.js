// Envío a WhatsApp Cloud API. Solo se usa del lado del servidor:
// el token vive en variables de entorno de Vercel y nunca se registra en logs.

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

export function whatsappConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export async function sendWhatsAppText(to, body) {
  if (!whatsappConfigured()) {
    const error = new Error(
      "Faltan WHATSAPP_ACCESS_TOKEN y/o WHATSAPP_PHONE_NUMBER_ID en Vercel"
    );
    error.code = "NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body, preview_url: false }
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || `WhatsApp respondió HTTP ${response.status}`
    );
    error.code = data?.error?.code;
    error.status = response.status;
    throw error;
  }

  return data?.messages?.[0]?.id || null;
}
