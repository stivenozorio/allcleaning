import { sendWhatsAppText, whatsappConfigured } from "./whatsapp.js";
import { AUTO_REPLY_TEXT } from "./auto-reply-text.js";

const onlyDigits = (value) => String(value || "").replace(/\D/g, "");

// ============================================
// RESPUESTA AUTOMÁTICA (una sola vez por conversación)
// ============================================
//
// Solo se invoca desde el procesamiento de `value.messages` del webhook,
// es decir, mensajes REALES entrantes del cliente. Los mensajes que envía
// nuestro sistema nunca llegan ahí (Meta solo manda `statuses` de ellos),
// así que no puede haber bucle.
//
// El "reclamo" es atómico (UPDATE ... WHERE auto_reply_sent = false):
// si Meta reintenta o llegan dos mensajes a la vez, solo uno envía.
export async function maybeSendAutoReply(
  supabase,
  { conversation, to, ownNumber }
) {
  try {
    // true => ya enviada. undefined => la columna aún no existe (migración pendiente).
    if (conversation?.auto_reply_sent !== false) return;

    // Nunca responder a nuestro propio número.
    if (ownNumber && onlyDigits(ownNumber) === onlyDigits(to)) return;

    if (!whatsappConfigured()) {
      console.warn(
        "⚠️ Respuesta automática omitida: WhatsApp no está configurado en Vercel"
      );
      return;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("conversations")
      .update({ auto_reply_sent: true })
      .eq("id", conversation.id)
      .eq("auto_reply_sent", false)
      .select("id");

    if (claimError) {
      console.error("❌ Error reclamando respuesta automática:", claimError);
      return;
    }

    if (!claimed?.length) return; // otro proceso ya la envió

    let whatsappMessageId = null;

    try {
      whatsappMessageId = await sendWhatsAppText(to, AUTO_REPLY_TEXT);
    } catch (sendError) {
      console.error(
        "❌ Error enviando respuesta automática:",
        sendError.code || "",
        sendError.message
      );

      // Liberar el reclamo para que pueda reintentarse con el próximo mensaje real.
      await supabase
        .from("conversations")
        .update({ auto_reply_sent: false })
        .eq("id", conversation.id);

      return;
    }

    const now = new Date().toISOString();

    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      whatsapp_message_id: whatsappMessageId,
      direction: "outgoing",
      message_type: "text",
      message_text: AUTO_REPLY_TEXT,
      sender_name: "Fuxi",
      status: "sent",
      sent_by: "automatic",
      timestamp: now
    });

    if (insertError) {
      console.error(
        "❌ Respuesta automática enviada pero no guardada:",
        insertError
      );
    }

    await supabase
      .from("conversations")
      .update({ last_message_at: now, updated_at: now })
      .eq("id", conversation.id);

    console.log("🤖 RESPUESTA AUTOMÁTICA ENVIADA:", conversation.id);
  } catch (error) {
    console.error("❌ Error inesperado en respuesta automática:", error);
  }
}

// ============================================
// ESTADOS DE ENTREGA (sent / delivered / read / failed)
// ============================================

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

export async function applyStatusUpdates(supabase, statuses) {
  for (const item of statuses || []) {
    try {
      const next = item?.status;

      if (!item?.id || !["sent", "delivered", "read", "failed"].includes(next)) {
        continue;
      }

      const { data: row, error } = await supabase
        .from("messages")
        .select("id, status")
        .eq("whatsapp_message_id", item.id)
        .maybeSingle();

      if (error) {
        console.error("❌ Error buscando mensaje para estado:", error);
        continue;
      }

      if (!row) {
        console.log("ℹ️ Estado de un mensaje no guardado:", item.id, next);
        continue;
      }

      // Nunca retroceder (p. ej. "read" -> "delivered" por eventos desordenados).
      if (next !== "failed" && (STATUS_RANK[row.status] || 0) >= STATUS_RANK[next]) {
        continue;
      }

      if (next === "failed" && STATUS_RANK[row.status] >= STATUS_RANK.delivered) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("messages")
        .update({ status: next })
        .eq("id", row.id);

      if (updateError) {
        console.error("❌ Error actualizando estado:", updateError);
      } else {
        console.log("📊 Estado actualizado:", item.id, next);
      }
    } catch (error) {
      console.error("❌ Error procesando estado:", error);
    }
  }
}
