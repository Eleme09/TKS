# Control remoto de Placer (Windows)

Hay **tres programas**. Los tres son visibles (consola o icono de bandeja,
según cuál), ninguno se esconde del Administrador de tareas, y por defecto
**nunca actúan sin que alguien frente al PC pulse "Sí"** en cada sesión — el
agente de nube tiene, además, un modo opcional "desatendido" que se activa
localmente en ese mismo equipo (ver su sección).

| Programa | Para qué sirve | Dónde se usa | Cómo se ve |
|---|---|---|---|
| `placer-servidor.exe` | Deja que otro PC **de tu misma red** lo vea y lo controle | En el PC al que te quieres conectar | Ventana de consola |
| `placer-visor.exe` | Mirar y controlar los PCs de tu red | En el PC desde donde miras | Ventana de consola |
| `placer-agente-nube.exe` | Lo mismo, pero **por internet** a través del sitio de TKS | Solo si el otro PC NO está en tu red | Icono en la bandeja del sistema |

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

Icono de bandeja (junto al reloj/wifi de Windows) que permite a un
administrador de TKS ver y controlar este equipo. Habla con `remote/relay.js`
(ruta `/ws/remote/agent`).

1. En el sitio (pantalla de control remoto) crea el equipo y copia su `id` y `token`
   (el token solo se muestra una vez).
2. Copia `config.example.json` como `config.json`, **en la misma carpeta que el .exe**:

```json
{ "server": "tks-4zsh.onrender.com", "device": "<id>", "token": "<token>" }
```

   `server` es el host del sitio (se usa siempre `wss://`). `ws://` solo se acepta
   con `"allowInsecure": true`, para pruebas locales. `config.json` contiene el token:
   no lo compartas (está en `.gitignore`).
3. Ejecuta `placer-agente-nube.exe`. Queda como un icono en la bandeja del sistema
   (si Windows colapsa los iconos, despliega la flechita `^` junto al reloj para verlo).
   No deja una ventana de consola abierta (ver "Icono de bandeja" más abajo).

### Modo normal (por defecto): pide permiso cada vez

Cuando alguien del sitio pide controlar el equipo, Windows muestra un aviso
nativo **Sí/No** a quien está frente al PC. Si nadie responde en 30 segundos
se rechaza solo. Nada se comparte (ni la pantalla) hasta que se acepta.

### Controlar un computador del estudio a distancia (por internet), sin que
### alguien tenga que aceptar cada vez — "modo desatendido"

Para un PC del estudio que se quiere poder tomar en cualquier momento (p. ej.
de madrugada, sin personal presente), hay una opción que **se activa en ese
mismo equipo**, nunca desde el sitio:

1. En el sitio, TKS → Cuentas → Control remoto: crea el equipo, copia `id` y `token`.
2. En `config.json` de ese equipo, agrega `"unattended": true`:

```json
{ "server": "tks-4zsh.onrender.com", "device": "<id>", "token": "<token>", "unattended": true }
```

3. Haz que arranque con Windows: crea un acceso directo de
   `placer-agente-nube.exe` dentro de `shell:startup` (escribe eso en el
   explorador de Windows, Enter, y suelta ahí el acceso directo). **Visible,
   un acceso directo normal** — no se usa ningún truco de servicio oculto.

Con esto, cuando alguien del sitio pide controlar el equipo, el agente
**acepta solo, sin mostrar el aviso Sí/No**. Lo que NO cambia:

- El icono de bandeja sigue ahí (no es un modo oculto): clic derecho muestra
  "Conectado a `<usuario del sitio>`" mientras hay sesión.
- **Ctrl+Shift+F12** sigue cortando la sesión al instante desde ese mismo
  equipo (y, en modo desatendido, bloquea por 60 s que se vuelva a aceptar
  automáticamente justo después de un corte, para que alguien que acaba de
  cortar no quede "reconectado" de inmediato).
- El relay sigue registrando en `cb_audit_log` quién se conectó, cuándo, y
  que fue sin aviso (`unattended: true`) — trazabilidad interna, no un aviso
  en pantalla.
- `"unattended": false` (o quitar la línea) vuelve al modo con aviso en
  cualquier momento, editando `config.json` en ese equipo y reiniciando el
  agente.

**Esto es una decisión LOCAL de quien instala el agente en ese PC — el sitio
nunca puede activarla a distancia.** Úsalo solo en equipos de la empresa, y
avisa al personal que trabaja ahí de que existe.

### Control total (teclas especiales)

El agente de nube permite, además del mouse y las teclas normales: la tecla
**Windows** y sus combinaciones (Win, Win+R, Win+E, Win+D), **Alt+Tab**,
**Alt+F4**, **Ctrl+Shift+Esc**, **Ctrl+C/V/X/Z**, **F1-F12**, **Impr Pant**,
escribir texto (incluye tildes/ñ) y pegar texto desde el visor. Cualquier
tecla que no esté en la lista permitida simplemente se ignora.

**Ctrl+Alt+Supr NO se puede mandar por software.** Es la "secuencia de
atención segura" de Windows: el sistema operativo la bloquea a propósito
para que ningún programa (ni este, ni ningún otro control remoto) pueda
inyectarla — es justamente lo que evita que un programa malicioso simule
esa pantalla. El botón del visor está deshabilitado con esa explicación. Si
hace falta bloquear la sesión o abrir el administrador de tareas a
distancia, usa **Ctrl+Shift+Esc** (sí se puede inyectar) o bloquea con
Win+L.

### Latencia y lo que hace que se sienta fluido

El visor usa control de flujo por confirmación (nunca se acumulan frames
viejos: si la red va lenta, se saltan y se manda siempre el estado más
reciente) y manda solo las regiones de la pantalla que cambiaron, no la
imagen entera cada vez — por eso un escritorio quieto apenas usa ancho de
banda. Aun así, **la latencia mínima real depende de la conexión a internet
de los dos lados** (el PC del estudio y quien lo controla): esto reduce el
"lag acumulado" típico de un control remoto mal hecho, pero no puede hacer
que una conexión lenta de por sí se sienta instantánea.

- `maxWidth` en `config.json` (por defecto 1600): ancho máximo, en píxeles,
  de lo que se manda. Bájalo (p. ej. 1280 o 1024) en un equipo con CPU lenta
  o con poca subida de internet — menos píxeles que codificar y mandar.
- `maxFps` en `config.json` (por defecto 20, tope 30): cuadros por segundo
  máximos. El agente ya ajusta fps/calidad solo según qué tan rápido
  confirma el visor; esto solo pone el techo.
- El selector de calidad del visor (Baja/Media/Alta) fija el límite de
  fps/calidad; dentro de ese límite, el agente sigue subiendo o bajando solo
  según la red, y baja la calidad mientras el mouse se mueve (para
  priorizar fluidez) y la sube cuando la pantalla queda quieta.

Se reconecta solo si se cae la red. Corte local: **Ctrl+Shift+F12** o "Salir"
del menú del icono de bandeja.

### Icono de bandeja: qué se ve y cómo se cierra

`placer-agente-nube.exe` **no deja una ventana de consola abierta** (se
compila con `-H=windowsgui`, ver "Compilar"): queda como un icono normal en
la bandeja del sistema, junto al wifi/batería/hora — igual que cualquier
otro programa (el antivirus, OneDrive, etc.). Si la bandeja los tiene
colapsados, hay que desplegar la flechita `^` para verlo.

- **Clic derecho**: menú con el estado actual ("En línea" / "Conectado a
  `<usuario>`" / "Desconectado del servidor"), **"Cerrar sesión actual"**
  (deshabilitado si no hay ninguna activa; equivale a Ctrl+Shift+F12), **"Ver
  registro"** (un cuadro simple con las últimas líneas de actividad) y
  **"Salir"**.
- **Doble clic**: abre lo mismo que "Ver registro".
- **"Salir" del menú es la ÚNICA forma de terminar el programa del todo.**
  El cuadro de "Ver registro" es modal (como cualquier mensaje de Windows):
  su botón de cerrar solo cierra ese cuadro, nunca el programa — mismo
  comportamiento que el botón X de Discord/Spotify/Steam, que minimiza a la
  bandeja en vez de matar el proceso.
- El icono es el genérico de aplicación de Windows (no uno a medida): un
  icono propio necesitaría compilar un recurso `.ico` (`.syso`), un paso de
  build aparte que no se justificó para esto — es una limitación conocida,
  no un descuido.
- El programa **nunca se oculta del Administrador de tareas** ni usa ningún
  truco de proceso oculto: sigue apareciendo ahí igual que cualquier otro.
- Sin consola, el registro de actividad va a `log.txt` (en la misma carpeta
  del `.exe`, se trunca si crece mucho) en vez de a una ventana — es lo que
  lee "Ver registro" y lo que conviene revisar si algo no cuadra.

**Decisión de implementación (por qué no se usó una librería de bandeja ya
hecha):** el `.exe` de Windows se compila desde Linux, sin un compilador de
C (`CGO_ENABLED=0`, ver "Compilar"). Las librerías de bandeja para Go que
existen, o llaman a la misma API de Windows que se necesita aquí
directamente, o dependen de cgo en alguna plataforma — así que la bandeja
(`internal/tray/tray_windows.go`) llama directo a `Shell_NotifyIconW` /
`RegisterClassExW` / `CreateWindowExW` vía `golang.org/x/sys/windows`, la
misma dependencia que ya usa el resto de este repo (captura, teclado,
diálogo Sí/No) y que compila igual de limpio sin cgo. Es más código a mano,
pero es la opción que de verdad no complica el cross-compile.

---

## Compilar

```
GOOS=windows GOARCH=amd64 go build -o placer-servidor.exe    ./cmd/servidor
GOOS=windows GOARCH=amd64 go build -o placer-visor.exe       ./cmd/visor
GOOS=windows GOARCH=amd64 go build -ldflags "-H=windowsgui" -o placer-agente-nube.exe ./cmd/agente-nube
```

`placer-servidor`/`placer-visor` siguen con consola (intencional: son
programas que se usan desde una ventana). `placer-agente-nube` se compila
con `-H=windowsgui` para que NO aparezca una ventana de consola — queda
como icono de bandeja (ver arriba). Los tres compilan con `CGO_ENABLED=0`
(sin toolchain de C), probado desde este mismo repo en Linux.

Estructura: `cmd/` tiene los tres programas; `internal/core` (captura, input,
consentimiento, teclas, JPEG, sesión, registro a archivo), `internal/proto`
(mensajes, emparejamiento, autenticación), `internal/lanserver` (servidor
TLS), `internal/visor` (página local y puente) e `internal/tray` (icono de
bandeja del agente de nube).

## Pruebas

`GOTOOLCHAIN=local go vet ./... && GOTOOLCHAIN=local go test ./...` (Linux o Windows) cubren:
protocolo y validación de mensajes, autenticación con secreto correcto/incorrecto, huella
(pinning) distinta, conexión sin TLS, fuerza bruta y bloqueo, límite de conexiones, una sola
sesión, lista de IP permitidas, anuncio UDP, generación/rotación del emparejamiento, el puente
visor↔servidor completo, el mapa de teclas en modo control total (Win y combos permitidos,
Ctrl+Alt+Supr siempre bloqueado), la división/recomposición en regiones (tiles) byte a byte, y
el control de flujo por confirmación (nunca más de 2 paquetes sin confirmar; con el visor
atrasado se salta en vez de encolar; `resync` fuerza un refresco completo).

Cross-compile verificado desde este contenedor Linux, sin toolchain de C
(`CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build ...`, con y sin
`-ldflags "-H=windowsgui"`), para los tres programas.

**No se puede probar sin un Windows y una red reales:** la captura de pantalla, el input
real, el diálogo Sí/No, la tecla de corte, el firewall, el broadcast UDP en una red de verdad,
el icono de bandeja (`Shell_NotifyIconW`, su menú y la ventana de "Ver registro"), y el
comportamiento real de la calidad/fps adaptativos y el salto de frames bajo una conexión lenta
de verdad (la lógica se probó con datos sintéticos, no con una red real atrasada).
