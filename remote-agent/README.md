# Agente de control remoto (Windows)

Programa visible que permite a un administrador de TKS ver y controlar este
equipo **solo después de que quien está frente a él acepte** cada solicitud.
Habla con `remote/relay.js` (ruta `/ws/remote/agent`).

## Configurar

1. En el sitio (pantalla de control remoto) crea el equipo y copia su `id` y `token`
   (el token solo se muestra una vez).
2. Copia `config.example.json` como `config.json`, **en la misma carpeta que el .exe**:

```json
{ "server": "tks-4zsh.onrender.com", "device": "<id>", "token": "<token>" }
```

   `server` es el host del sitio (se usa siempre `wss://`). `ws://` solo se acepta
   con `"allowInsecure": true`, para pruebas locales. `config.json` contiene el token:
   no lo compartas (está en `.gitignore`).
3. Ejecuta `placer-remoto.exe`. Debe quedar la ventana negra abierta.

## Compilar

```
GOOS=windows GOARCH=amd64 go build -o placer-remoto.exe .
```

(Sin `-H windowsgui`: la ventana de consola es intencional.)

## Qué hace

- Se conecta al sitio, se autentica y espera. No comparte nada mientras no haya solicitud.
- Cuando un administrador pide control, muestra un diálogo de Windows (Sí/No) con su
  nombre. Si no respondes en 30 s, se rechaza solo.
- Si aceptas: envía la pantalla principal (JPEG, ~6 fps, máx. 1600 px de ancho) y ejecuta
  el mouse/teclado que mande el visor. La ventana muestra una franja roja
  **"SESIÓN REMOTA ACTIVA"** todo el tiempo que dure.
- Se reconecta solo si se cae la red.

## Cómo cortar una sesión

- **Ctrl+Shift+F12** en cualquier momento, o
- cerrar la ventana del agente (o Ctrl+C).

## Qué NO hace

- No se inicia solo con Windows, no corre oculto, no tiene modo desatendido.
- No graba ni guarda pantalla en disco; los frames solo se envían en vivo.
- No actúa sin tu "Sí" en cada sesión (tampoco tras una reconexión).
- Bloquea la tecla Windows y Ctrl+Alt+Supr; ignora cualquier tecla fuera de su lista.

## Pruebas

`go vet ./... && go test ./...` (en Linux/Windows) cubren protocolo, config, URL,
mapeo de teclas y codificación de frames. La captura de pantalla, el input
real, el diálogo y la tecla de corte solo se pueden probar en un Windows real.
