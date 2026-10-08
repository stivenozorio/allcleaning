import { createClient } from "@supabase/supabase-js";

// Cliente de servidor: usa SOLO la clave secreta (nunca se registra en logs).
// Se crea de forma diferida para que la verificación GET de Meta funcione
// aunque falte alguna variable de entorno.
let supabaseClient = null;

function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;

    if (!url || !key) {
      throw new Error(
        "Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SECRET_KEY"
      );
    }

    supabaseClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  return supabaseClient;
}

export default async function handler(req, res) {
  // ============================================
  // VERIFICACIÓN DE META
  // ============================================

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Token de verificación incorrecto");
  }

  // ============================================
  // MENSAJES DE WHATSAPP
  // ============================================

  if (req.method === "POST") {
    console.log("=================================");
    console.log("📩 WEBHOOK DE WHATSAPP RECIBIDO");
    console.log("=================================");

    const body = req.body;

    console.log("Objeto:", body?.object);

    const entries = body?.entry || [];

    try {
      const supabase = getSupabase();

      for (const entry of entries) {
        const changes = entry?.changes || [];

        for (const change of changes) {
          const value = change?.value;

          console.log("Campo:", change?.field);

          // ============================================
          // MENSAJES
          // ============================================

          if (value?.messages) {
            for (const message of value.messages) {
              console.log("📨 MENSAJE:");
              console.log("ID:", message.id);
              console.log("De:", message.from);
              console.log("Tipo:", message.type);

              const whatsappNumber = message.from;

              let messageText = null;

              if (message.type === "text") {
                messageText = message.text?.body;

                console.log("Texto:", messageText);
              }

              // ============================================
              // CONTACTO
              // ============================================

              let contactName = null;

              if (value?.contacts?.length) {
                const whatsappContact = value.contacts.find(
                  (contact) => contact.wa_id === whatsappNumber
                );

                contactName =
                  whatsappContact?.profile?.name ||
                  whatsappContact?.name?.formatted_name ||
                  null;
              }

              console.log("👤 Nombre:", contactName);

              // ============================================
              // EVITAR MENSAJES DUPLICADOS
              // ============================================

              const { data: existingMessage, error: existingError } =
                await supabase
                  .from("messages")
                  .select("id")
                  .eq("whatsapp_message_id", message.id)
                  .maybeSingle();

              if (existingError) {
                console.error(
                  "❌ Error verificando duplicado:",
                  existingError
                );
                continue;
              }

              if (existingMessage) {
                console.log("⚠️ Mensaje ya registrado:", message.id);
                continue;
              }

              // ============================================
              // CREAR / ACTUALIZAR CONTACTO
              // ============================================

              let { data: contact, error: contactError } = await supabase
                .from("contacts")
                .select("*")
                .eq("whatsapp_number", whatsappNumber)
                .maybeSingle();

              if (contactError) {
                console.error(
                  "❌ Error buscando contacto:",
                  contactError
                );
                continue;
              }

              if (!contact) {
                const { data: newContact, error: createContactError } =
                  await supabase
                    .from("contacts")
                    .insert({
                      whatsapp_number: whatsappNumber,
                      name: contactName
                    })
                    .select()
                    .single();

                if (createContactError) {
                  console.error(
                    "❌ Error creando contacto:",
                    createContactError
                  );
                  continue;
                }

                contact = newContact;

                console.log("✅ Contacto creado:", contact.id);
              } else {
                if (contactName && contact.name !== contactName) {
                  const { data: updatedContact, error: updateError } =
                    await supabase
                      .from("contacts")
                      .update({
                        name: contactName
                      })
                      .eq("id", contact.id)
                      .select()
                      .single();

                  if (!updateError) {
                    contact = updatedContact;
                  }
                }

                console.log("👤 Contacto existente:", contact.id);
              }

              // ============================================
              // BUSCAR CONVERSACIÓN ABIERTA
              // ============================================

              let { data: conversation, error: conversationError } =
                await supabase
                  .from("conversations")
                  .select("*")
                  .eq("contact_id", contact.id)
                  .in("status", ["open", "pending"])
                  .order("updated_at", { ascending: false })
                  .limit(1)
                  .maybeSingle();

              if (conversationError) {
                console.error(
                  "❌ Error buscando conversación:",
                  conversationError
                );
                continue;
              }

              // ============================================
              // CREAR CONVERSACIÓN
              // ============================================

              if (!conversation) {
                const { data: newConversation, error: createConversationError } =
                  await supabase
                    .from("conversations")
                    .insert({
                      contact_id: contact.id,
                      status: "open",
                      unread_count: 0,
                      last_message_at: new Date().toISOString()
                    })
                    .select()
                    .single();

                if (createConversationError) {
                  console.error(
                    "❌ Error creando conversación:",
                    createConversationError
                  );
                  continue;
                }

                conversation = newConversation;

                console.log(
                  "✅ Conversación creada:",
                  conversation.id
                );
              }

              // ============================================
              // GUARDAR MENSAJE
              // ============================================

              const messageTimestamp = message.timestamp
                ? new Date(Number(message.timestamp) * 1000).toISOString()
                : new Date().toISOString();

              const { error: messageError } = await supabase
                .from("messages")
                .insert({
                  conversation_id: conversation.id,
                  whatsapp_message_id: message.id,
                  direction: "incoming",
                  message_type: message.type || "text",
                  message_text: messageText,
                  sender_name: contactName,
                  status: "received",
                  timestamp: messageTimestamp
                });

              if (messageError) {
                if (messageError.code === "23505") {
                  console.log("⚠️ Mensaje duplicado (reintento):", message.id);
                  continue;
                }

                console.error(
                  "❌ Error guardando mensaje:",
                  messageError
                );
                continue;
              }

              // ============================================
              // ACTUALIZAR CONVERSACIÓN
              // ============================================

              const { error: updateConversationError } = await supabase
                .from("conversations")
                .update({
                  last_message_at: messageTimestamp,
                  unread_count: (conversation.unread_count || 0) + 1,
                  updated_at: new Date().toISOString()
                })
                .eq("id", conversation.id);

              if (updateConversationError) {
                console.error(
                  "❌ Error actualizando conversación:",
                  updateConversationError
                );
              }

              console.log("✅ MENSAJE GUARDADO EN SUPABASE");
            }
          }

          // ============================================
          // CONTACTOS
          // ============================================

          if (value?.contacts) {
            console.log(
              "👤 CONTACTOS:",
              JSON.stringify(value.contacts)
            );
          }

          // ============================================
          // ESTADOS
          // ============================================

          if (value?.statuses) {
            console.log(
              "📊 ESTADO:",
              JSON.stringify(value.statuses)
            );
          }
        }
      }

      console.log("=================================");

      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("❌ ERROR GENERAL DEL WEBHOOK:", error);

      // IMPORTANTE:
      // Respondemos 200 para evitar reintentos innecesarios
      // de Meta mientras estamos desarrollando.
      return res.status(200).send("EVENT_RECEIVED");
    }
  }

  return res.status(405).send("Método no permitido");
}
