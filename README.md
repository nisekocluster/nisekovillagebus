# Niseko Village Bus — Railway Deployment

## Estructura
```
railway/
├── server.js          ← API Express
├── package.json
├── schema.sql         ← Correr una sola vez en PostgreSQL
├── README.md
└── public/
    ├── niseko-village-bus.html   ← Guest app
    └── nvbus-admin.html          ← Admin panel
```

## Setup en Railway (paso a paso)

### 1. Crear el proyecto
```bash
railway login
railway init          # crear nuevo proyecto
```

### 2. Agregar PostgreSQL
En el dashboard de Railway → **+ New** → **Database** → **PostgreSQL**

### 3. Correr el schema
```bash
railway run psql $DATABASE_URL -f schema.sql
```

### 4. Variables de entorno
En Railway → tu servicio → **Variables**, agregar:

| Variable       | Valor                          |
|----------------|--------------------------------|
| `JWT_SECRET`   | una string larga y aleatoria   |
| `PASS_NISEKO`  | password del admin general     |
| `PASS_RITZ`    | password del Ritz-Carlton      |
| `PASS_MOXY`    | password del Moxy              |

> Si no se setean PASS_*, los valores por defecto del código se usan (solo para desarrollo).

### 4b. Correos automáticos (Resend) — `mailer.js`
1. Crear cuenta en https://resend.com → **Domains** → agregar `nisekovillagebus.com` y copiar los registros DNS (SPF/DKIM) en el proveedor del dominio. Esperar a que diga *Verified*.
2. **API Keys** → crear una key con permiso *Sending access*.
3. En Railway → **Variables**:

| Variable          | Valor                                                        |
|-------------------|--------------------------------------------------------------|
| `RESEND_API_KEY`  | la key de Resend (`re_...`)                                  |
| `MAIL_FROM`       | `Niseko Village Bus <bookings@nisekovillagebus.com>`         |
| `MAIL_REPLY_TO`   | (opcional) correo donde llegan las respuestas de los clientes |
| `TEAM_EMAILS`     | avisos de Hilton, Hinode, Hilton NV Staff y Niseko Village Staff (y de Moxy/Ritz si su variable está vacía), separados por coma |
| `TEAM_EMAIL_MOXY` | solo avisos y respuestas de clientes Moxy + Moxy Staff       |
| `TEAM_EMAIL_RITZ` | solo avisos y respuestas de clientes Ritz-Carlton + Ritz Carlton Staff |

Correos que se envían:
- **Reserva recibida** → al cliente/staff al enviar el formulario + aviso al equipo.
- **Reserva confirmada** → cuando el estado pasa a *confirmed* (incluye "Confirm all").
- **Reserva cancelada** → cuando el estado pasa a *cancelled* (manual o al aprobar una solicitud).
- **Solicitud de cancelación** → aviso al equipo.

Sin `RESEND_API_KEY` no se envía nada (solo queda en el log). Los horarios de recogida del correo están copiados en `mailer.js` (`BUS_TIMES`): si cambian los buses en el HTML, actualizarlos ahí también.

### 5. Deploy
```bash
railway up
```

Railway detecta `package.json` y corre `npm start` automáticamente.

### 6. Acceso
- Guest app:  `https://tu-proyecto.railway.app/niseko-village-bus.html`
- Admin:      `https://tu-proyecto.railway.app/nvbus-admin.html`

---

## API_BASE
Si en algún momento los HTMLs se sirven desde un dominio distinto al servidor,
editar la línea en cada archivo:
```js
const API_BASE = '';  // ← poner la URL completa, ej: 'https://nvbus-api.railway.app'
```

---

## Usuarios
| Usuario  | Role   | Acceso                    |
|----------|--------|---------------------------|
| `niseko` | master | Todo (todas las reservas) |
| `ritz`   | hotel  | Solo Ritz-Carlton Reserve |
| `moxy`   | hotel  | Solo Moxy                 |

Hilton e Hinode Hills → login con `niseko`.
