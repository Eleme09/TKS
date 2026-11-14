# Control remoto de Placer (Windows)

Hay **tres programas**. Los tres son visibles (ventana negra abierta), no se
esconden, no arrancan solos con Windows y **nunca actúan sin que alguien frente
al PC pulse "Sí"** en cada sesión.

| Programa | Para qué sirve | Dónde se usa |
|---|---|---|
| `placer-servidor.exe` | Deja que otro PC **de tu misma red** lo vea y lo controle | En el PC al que te quieres conectar |
| `placer-visor.exe` | Mirar y controlar los PCs de tu red | En el PC desde donde miras |
| `placer-agente-nube.exe` | Lo mismo, pero **por internet** a través del sitio de TKS | Solo si el otro PC NO está en tu red |

> **Importante:** `placer-servidor` + `placer-visor` **solo funcionan dentro de la
> misma red local** (mismo wifi / mismo router). Para otra red usa el agente de nube.

---

## 1. Red local: servidor + visor

### En el PC al que te conectas (servidor)

1. Pon `placer-servidor.exe` en una carpeta (ej. `C:\Placer\`).
2. (Opcional) Copia `config.servidor.example.json` como `config.json` en esa
   misma carpeta y cambia el nombre. Si no hay `config.json` se usan valores normales
   (puerto 5911, el nombre del PC).
3. Abre `placer-servidor.exe`. **No hay contraseña que escribir.**
   La primera vez crea solo el **archivo de emparejamiento** `pairing.json` y avisa
   en la ventana. Ese archivo es **la llave**.
4. Deja la ventana abierta. Muestra el puerto y las IP del PC.

### Emparejar (una sola vez por PC)

1. Copia `pairing.json` del servidor al PC del visor (USB o carpeta segura).
   **No lo mandes por chat ni correo y no lo compartas: quien lo tenga puede entrar.**
2. En el PC del visor abre `placer-visor.exe`. Se abre una página en el navegador.
3. **Arrastra `pairing.json` al recuadro "Equipos emparejados"** (o tócalo para elegirlo).
   También sirve arrastrar el archivo encima del `.exe`.
4. Listo: el PC aparece en "Equipos en tu red" con el botón **Conectar**.

### Conectar

1. En la página del visor pulsa **Conectar** junto al PC.
2. En el PC del servidor sale un aviso de Windows: **Sí / No**. Si nadie responde
   en 30 segundos se rechaza solo.
3. Si aceptan, ves la pantalla y puedes usar mouse y teclado. El servidor muestra una
   franja roja **"SESIÓN REMOTA ACTIVA"** todo el tiempo.

Si el PC no aparece solo, usa **"Agregar equipo manualmente"** y escribe su IP
(ej. `192.168.1.20:5911`; la IP la muestra la ventana del servidor).

### Cortar una sesión

En el PC del servidor: **Ctrl+Shift+F12**, o cerrar la ventana negra.

### Cambiar la llave (rotar)

Si perdiste el archivo, alguien lo copió o cambió de dueño el equipo:
**cierra el servidor, borra `pairing.json` y ábrelo de nuevo.** Crea una llave y un
certificado nuevos; la llave vieja deja de servir al instante. Hay que volver a
emparejar los visores con el `pairing.json` nuevo.

### Abrir el firewall de Windows (en el PC del servidor)

Windows suele preguntar al abrir el programa por primera vez: elige **"Redes privadas"**
y acepta. Si no, créalo a mano (Firewall de Windows → Configuración avanzada → Reglas de entrada):

- **TCP 5911** entrante (o el puerto de `config.json`) — la conexión.
- **UDP 5910** entrante en el **PC del visor** — para que el visor vea los anuncios
  (en el servidor es saliente y no necesita regla).

### Opciones de `config.json` (servidor)

| Campo | Qué hace |
|---|---|
| `port` | Puerto TCP (por defecto 5911) |
| `name` | Nombre que se muestra (por defecto, el del PC) |
| `viewOnly` | `true` = solo ver, sin mouse ni teclado |
| `announce` | `false` = no se anuncia en la red; se conecta solo escribiendo la IP |
| `allowedViewerIPs` | Lista opcional de IP o rangos que pueden intentarlo, ej. `["192.168.1.20","192.168.1.0/24"]` |

### Qué tan seguro es

- Todo viaja por **TLS 1.3**. El visor **fija la huella del certificado** del servidor
  (la del `pairing.json`) y rechaza cualquier otro equipo, aunque tenga el mismo nombre.
- Autenticación **en los dos sentidos** con el secreto de 256 bits del emparejamiento
  (nunca viaja por la red). Sin ese secreto no hay forma de entrar: no sirve ninguna
  clave de la empresa ni estar en el mismo wifi.
- Quien no esté emparejado **no recibe nada**: ni nombre, ni versión, ni mensajes de error.
  La conexión se cierra en silencio.
- Tras **5 intentos fallidos** esa IP queda bloqueada **15 minutos**. Hay un tope de
  conexiones sin autenticar y **una sola sesión a la vez**.
- El anuncio en la red solo dice el nombre y el puerto.
- La página del visor solo responde en este mismo PC (`127.0.0.1`), con una dirección
  secreta distinta en cada arranque; otras páginas del navegador o programas no pueden usarla.
- Aun con todo lo anterior, **el "Sí" local de cada sesión sigue siendo obligatorio**.
  Bloquea la tecla Windows y Ctrl+Alt+Supr.

### Qué hace `placer-visor.exe` por dentro

Abre un servidor web **solo en tu PC** y el navegador por defecto. Esa página es la
interfaz; el visor hace de puente hacia el servidor remoto. Guarda los emparejamientos
(con sus secretos) en `visor-pairings.json`, junto al `.exe`: protege esa carpeta como
protegerías una contraseña.

---

## 2. Agente de nube (por internet)

Programa visible que permite a un administrador de TKS ver y controlar este
equipo **solo después de que quien está frente a él acepte** cada solicitud.
Habla con `remote/relay.js` (ruta `/ws/remote/agent`).

1. En el sitio (pantalla de control remoto) crea el equipo y copia su `id` y `token`
   (el token solo se muestra una vez).
2. Copia `config.example.json` como `config.json`, **en la misma carpeta que el .exe**:

```json
{ "server": "tks-4zsh.onrender.com", "device": "<id>", "token": "<token>" }
```

   `server` es el host del sitio (se usa siempre `wss://`). `ws://` solo se acepta
   con `"allowInsecure": true`, para pruebas locales. `config.json` contiene el token:
   no lo compartas (está en `.gitignore`).
3. Ejecuta `placer-agente-nube.exe`. Debe quedar la ventana negra abierta.

Se reconecta solo si se cae la red. Corte local: **Ctrl+Shift+F12** o cerrar la ventana.

---

## Compilar

```
GOOS=windows GOARCH=amd64 go build -o placer-servidor.exe    ./cmd/servidor
GOOS=windows GOARCH=amd64 go build -o placer-visor.exe       ./cmd/visor
GOOS=windows GOARCH=amd64 go build -o placer-agente-nube.exe ./cmd/agente-nube
```

(Sin `-H windowsgui`: la ventana de consola es intencional.)

Estructura: `cmd/` tiene los tres programas; `internal/core` (captura, input,
consentimiento, teclas, JPEG, sesión), `internal/proto` (mensajes, emparejamiento,
autenticación), `internal/lanserver` (servidor TLS) e `internal/visor` (página local y puente).

## Pruebas

`go vet ./... && go test ./...` (Linux o Windows) cubren: protocolo y validación de mensajes,
autenticación con secreto correcto/incorrecto, huella (pinning) distinta, conexión sin TLS,
fuerza bruta y bloqueo, límite de conexiones, una sola sesión, lista de IP permitidas,
anuncio UDP, generación/rotación del emparejamiento y el puente visor↔servidor completo.

**No se puede probar sin un Windows y una red reales:** la captura de pantalla, el input
real, el diálogo Sí/No, la tecla de corte, el firewall y el broadcast UDP en una red de verdad.
