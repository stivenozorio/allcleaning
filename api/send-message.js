import { getAdmin, requireUser } from "./_lib/auth.js";
import { sendWhatsAppText } from "./_lib/whatsapp.js";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_LENGTH = 4096;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const user = await requireUser(req);

    if (!user) {
      return res.status(401).json({ error: "Sesión no válida" });
    }

    const conversationId = req.body?.conversation_id;
    const text =
      typeof req.body?.text === "string" ? req.body.text.trim() : "";

    if (!conversationId || !text) {
      return res.status(400).json({ error: "Falta la conversación o el texto" });
    }

    if (text.length > MAX_LENGTH) {
      return res.status(400).json({ error: "El mensaje es demasiado largo" });
    }

    const supabase = getAdmin();

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, contact_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError || !conversation) {
      return res.status(404).json({ error: "Conversación no encontrada" });
    }

    const { data: contact } = await supabase
      .from("contacts")
      .select("whatsapp_number")
      .eq("id", conversation.contact_id)
      .maybeSingle();

    if (!contact?.whatsapp_number) {
      return res.status(422).json({ error: "El contacto no tiene número de WhatsApp" });
    }

    // Ventana de 24 h: se mide desde el último mensaje ENTRANTE del cliente.
    const { data: lastIncoming } = await supabase
      .from("messages")
      .select("timestamp")
      .eq("conversation_id", conversation.id)
      .eq("direction", "incoming")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastTime = lastIncoming?.timestamp
      ? new Date(lastIncoming.timestamp).getTime()
      : 0;

    if (!lastTime || Date.now() - lastTime > WINDOW_MS) {
      return res.status(409).json({
        code: "WINDOW_CLOSED",
        error:
          "Pasaron más de 24 horas desde el último mensaje del cliente. Debes usar una plantilla de WhatsApp aprobada."
      });
    }

    let whatsappMessageId;

    try {
      whatsappMessageId = await sendWhatsAppText(contact.whatsapp_number, text);
    } catch (sendError) {
      console.error(
        "❌ Error enviando a WhatsApp:",
        sendError.code || "",
        sendError.message
      );

      if (sendError.code === "NOT_CONFIGURED") {
        return res.status(503).json({ error: sendError.message });
      }

      // 131047: fuera de la ventana de 24 h según Meta.
      if (sendError.code === 131047) {
        return res.status(409).json({
          code: "WINDOW_CLOSED",
          error:
            "WhatsApp rechazó el envío: la ventana de 24 horas está cerrada. Usa una plantilla aprobada."
        });
      }

      return res.status(502).json({
        error: `WhatsApp no aceptó el mensaje: ${sendError.message}`
      });
    }

    const now = new Date().toISOString();

    const { data: message, error: insertError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        whatsapp_message_id: whatsappMessageId,
        direction: "outgoing",
        message_type: "text",
        message_text: text,
        sender_name: user.user_metadata?.name || user.email || "Agente",
        status: "sent",
        sent_by: "agent",
        timestamp: now
      })
      .select()
      .single();

    if (insertError) {
      console.error("❌ Mensaje enviado pero no guardado:", insertError);

      return res.status(200).json({
        ok: true,
        warning: "El mensaje se envió pero no pudo guardarse en el historial"
      });
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: now, updated_at: now })
      .eq("id", conversation.id);

    return res.status(200).json({ ok: true, message });
  } catch (error) {
    console.error("❌ Error en send-message:", error.message);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
