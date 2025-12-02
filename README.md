# 🤖 BotCrmF5 - Documentación del Proyecto

Este proyecto consiste en un bot de Slack integrado con una base de datos SQL Server y un servidor Express. Su propósito principal es facilitar la consulta de información del CRM y notificar a los usuarios sobre el estado de sus tareas.

## 🌟 Características Principales

- **Bot de Slack Interactivo**: Los usuarios pueden interactuar con el bot a través de mensajes directos para ejecutar comandos.
- **Reportes de Horas**: Generación de reportes de horas registradas, tanto mensuales como del mes anterior.
- **Consultas de Perfil**: Los usuarios pueden consultar su propia información de perfil almacenada en el sistema.
- **Notificaciones de Tareas**: Un endpoint HTTP permite que sistemas externos (como GeneXus) notifiquen a los usuarios sobre la asignación o finalización de tareas.
- **Comandos Administrativos**: Funcionalidades para administradores, como enviar reportes masivos a todos los funcionarios.
- **Servidor Express**: Provee una API RESTful para consultas directas a la base de datos.

---

## 📁 Estructura del Proyecto

El proyecto está organizado en los siguientes directorios principales:

```
BotCrmF5/
├── app.js               # Punto de entrada del servidor Express.
├── package.json         # Dependencias y scripts del proyecto.
├── .env                 # Archivo para variables de entorno (no incluido en git).
├── .gitignore           # Archivos y carpetas ignorados por git.
├── bot/
│   ├── botCore.js       # Núcleo del bot de Slack, maneja eventos y comandos.
│   ├── commands/        # Lógica de cada comando del bot.
│   │   ├── checkAll.js
│   │   ├── checkAllPast.js
│   │   ├── checkCommands.js
│   │   ├── checkMe.js
│   │   ├── checkMePast.js
│   │   └── checkMyProfile.js
│   └── functions/
│       └── notifyTasks.js # Lógica para el endpoint de notificaciones.
├── controllers/         # (Vacío, la lógica está en 'services' y 'bot/commands').
├── db/
│   └── conection.js     # Configuración y pool de conexión a la base de datos.
├── routes/
│   └── Consultas.js     # Rutas de la API Express.
├── services/
│   └── Consultas.js     # Lógica de negocio para las rutas de la API.
└── utils/               # (Vacío, para futuras funciones de utilidad).
```

---

## 🛠️ Descripción de Archivos Clave

### `app.js`
Es el punto de entrada que inicializa el servidor **Express**. Configura los middlewares (como `express.json`) y monta las rutas definidas en `routes/Consultas.js` bajo el prefijo `/botCrmF5`.

### `bot/botCore.js`
Es el corazón del bot de Slack.
1.  **Inicializa la App de Bolt**: Configura el bot con el token y un `ExpressReceiver`.
2.  **Expone Endpoint para GeneXus**: Crea un endpoint `POST /api/notificar-tareas/:vaDirigidoA/:TarSec` para recibir notificaciones de sistemas externos.
3.  **Maneja Comandos**: Escucha los mensajes directos, identifica el comando y delega la ejecución a la clase correspondiente en el directorio `bot/commands/`.
4.  **Responde en Hilos**: Mantiene las conversaciones organizadas respondiendo en hilos al mensaje original del usuario.

### `bot/commands/`
Este directorio contiene la lógica específica para cada comando que el bot puede ejecutar.

-   `checkCommands.js`: Responde al comando `info` o `ayuda`, mostrando una lista de todos los comandos disponibles.
-   `checkMyProfile.js`: Responde a `unicheck`. Obtiene y muestra la información del perfil del usuario que ejecuta el comando, combinando datos de Slack y de la base de datos (nombre, cargo, credenciales CRM, etc.).
-   `checkMe.js`: Responde a `crm-check-me`. Genera un reporte detallado de las horas registradas por el usuario en el **mes actual** (hasta el día anterior), desglosado por semanas y días.
-   `checkMePast.js`: Responde a `crm-check-me-past`. Similar al anterior, pero genera el reporte para el **mes anterior completo**.
-   `checkAll.js`: Comando de administrador (`crm-check-all-admin`). Envía un reporte de horas del **mes actual** a **todos** los funcionarios activos. Solo se envía el reporte si el funcionario tiene horas pendientes.
-   `checkAllPast.js`: Comando de administrador (`crm-check-all-admin-past`). Hace lo mismo que `checkAll`, but para el **mes anterior completo**.

### `bot/functions/notifyTasks.js`
Contiene la lógica para el endpoint de notificaciones. Cuando GeneXus llama a la URL, este archivo se encarga de:
1.  Identificar al destinatario (el asignado a la tarea o el creador de la misma).
2.  Buscar el ID de usuario de Slack a partir de su `username` (almacenado en la BD).
3.  Enviar un mensaje directo notificando la asignación o finalización de la tarea.

### `db/conection.js`
Configura y exporta el **pool de conexiones** a la base de datos SQL Server. Utiliza las variables de entorno (`DB_USER`, `DB_PASS`, etc.) para una configuración segura.

### `routes/Consultas.js` y `services/Consultas.js`
Definen la API RESTful.
-   `routes/Consultas.js` define la ruta `GET /funcionarios`.
-   `services/Consultas.js` contiene el método `getFun` que ejecuta la consulta `SELECT * FROM Funcionarios` y devuelve la lista de funcionarios activos.

---

## 🚀 Cómo Empezar

### Prerrequisitos

-   Node.js (v14 o superior)
-   npm (generalmente incluido con Node.js)
-   Acceso a una base de datos SQL Server.
-   Credenciales de una App de Slack (Bot Token y Signing Secret).

### Instalación

1.  **Clonar el repositorio:**
    ```bash
    git clone <URL_DEL_REPOSITORIO>
    cd BotCrmF5
    ```

2.  **Instalar dependencias:**
    ```bash
    npm install
    ```

3.  **Configurar variables de entorno:**
    Crea un archivo `.env` en la raíz del proyecto y añade las siguientes variables:

    ```env
    # Credenciales de Slack
    SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxxxxxx-xxxxxxxx
    SLACK_SIGNING_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

    # Configuración de la Base de Datos
    DB_USER=tu_usuario_db
    DB_PASS=tu_contraseña_db
    DB_SERVER=localhost
    DB_NAME=tu_base_de_datos

    # Configuración del Servidor
    PORT=3000
    HOSTNAME=localhost
    ```

### Ejecución

Para iniciar tanto el bot de Slack como el servidor Express, ejecuta:

```bash
node bot/botCore.js
```

El bot estará escuchando eventos de Slack, y el servidor Express estará disponible en `http://localhost:3000`.

---

## ⚙️ Comandos del Bot

Para usar los comandos, envía un mensaje directo al bot en Slack con uno de los siguientes textos:

-   `info` / `ayuda`: Muestra la lista de comandos disponibles.
-   `unicheck`: Muestra tu perfil de funcionario y credenciales del CRM.
-   `crm-check-me`: Recibe tu reporte de horas registradas del mes actual.
-   `crm-check-me-past`: Recibe tu reporte de horas del mes pasado.

### Comandos de Administrador

Estos comandos solo pueden ser ejecutados por usuarios autorizados.

-   `crm-check-all-admin`: Envía reportes de horas del mes actual a todos los usuarios con registros pendientes.
-   `crm-check-all-admin-past`: Envía reportes de horas del mes anterior a todos los usuarios con registros pendientes.

---

## 🔌 Endpoints de la API

### Notificación de Tareas (para GeneXus)

-   **URL**: `/api/notificar-tareas/:vaDirigidoA/:TarSec`
-   **Método**: `POST`
-   **Parámetros**:
    -   `vaDirigidoA`: Define el destinatario.
        -   `NotificarAsignado`: Envía una notificación al funcionario al que se le asignó la tarea.
        -   `NotificarCreador`: Envía una notificación al funcionario que creó la tarea cuando esta finaliza.
    -   `TarSec`: El ID único de la tarea en la base de datos.

### Consulta de Funcionarios

-   **URL**: `/botCrmF5/funcionarios`
-   **Método**: `GET`
-   **Respuesta**: Devuelve un objeto JSON con una lista de todos los funcionarios activos.
