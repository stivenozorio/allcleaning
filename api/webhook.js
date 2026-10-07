export default async function handler(req, res) {
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

  if (req.method === "POST") {
    console.log("=================================");
    console.log("📩 WEBHOOK DE WHATSAPP RECIBIDO");
    console.log("=================================");

    const body = req.body;

    console.log("Objeto:", body?.object);

    const entries = body?.entry || [];

    for (const entry of entries) {
      const changes = entry?.changes || [];

      for (const change of changes) {
        const value = change?.value;

        console.log("Campo:", change?.field);

        if (value?.messages) {
          for (const message of value.messages) {
            console.log("📨 MENSAJE:");
            console.log("ID:", message.id);
            console.log("De:", message.from);
            console.log("Tipo:", message.type);

            if (message.type === "text") {
              console.log("Texto:", message.text?.body);
            }
          }
        }

        if (value?.contacts) {
          console.log("👤 CONTACTOS:", JSON.stringify(value.contacts));
        }

        if (value?.statuses) {
          console.log("📊 ESTADO:", JSON.stringify(value.statuses));
        }
      }
    }

    console.log("=================================");

    return res.status(200).send("EVENT_RECEIVED");
  }

  return res.status(405).send("Método no permitido");
}
