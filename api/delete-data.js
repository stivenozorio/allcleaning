export default function handler(req, res) {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Eliminación de datos - All Cleaning</title>
    </head>
    <body>
      <h1>Solicitud de eliminación de datos</h1>

      <p>
        Si deseas solicitar la eliminación de tus datos personales
        asociados a All Cleaning Colombia, puedes comunicarte con nosotros
        para solicitar la eliminación de la información correspondiente.
      </p>

      <p>
        Envía tu solicitud indicando el número de teléfono utilizado
        para comunicarte con nuestra empresa.
      </p>

      <p>
        All Cleaning Colombia procesará la solicitud de acuerdo con
        la legislación aplicable sobre protección de datos personales.
      </p>
    </body>
    </html>
  `);
}
