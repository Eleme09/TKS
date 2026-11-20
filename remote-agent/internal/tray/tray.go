// Package tray: icono de bandeja del sistema para el agente de nube.
//
// Decisión de implementación (pedida explícitamente: documentarla): NO se usó
// una librería de terceros (p.ej. github.com/getlantern/systray) porque todas
// las que existen para Go, o envuelven la misma API de Win32 que usamos aquí
// directamente, o dependen de cgo para otras plataformas — y este proyecto
// cruza-compila el .exe de Windows desde Linux SIN toolchain de C (ver
// README: "GOTOOLCHAIN=local go build", sin CGO_ENABLED=1 ni gcc). La
// implementación de abajo (tray_windows.go) llama a Shell_NotifyIconW /
// RegisterClassExW / CreateWindowExW directamente vía
// golang.org/x/sys/windows + syscall, que es la misma dependencia que ya usa
// el resto de internal/core (consent_windows.go, input_windows.go, etc.) y
// compila igual de limpio con CGO_ENABLED=0. Es más código a mano que
// "import systray" pero es la opción que de verdad no complica el
// cross-compile.
//
// El icono usado es el genérico de Windows (IDI_APPLICATION, sin archivo
// .ico propio): bordar un icono a medida requeriría compilar un recurso
// .syso (windres o un generador de recursos), un paso más de build que no
// se justificó para esto — queda documentado como limitación conocida, no
// como descuido.
package tray

// Tray es el icono de bandeja del agente de nube. En Windows (tray_windows.go)
// es un icono real con menú; en cualquier otra plataforma (tray_stub.go, solo
// para que `go vet`/`go test` compilen en Linux) no hace nada.
type Tray struct {
	// OnCloseSession: "Cerrar sesión actual" del menú (equivale a Ctrl+Shift+F12).
	OnCloseSession func()
	// OnQuit: "Salir" del menú — la ÚNICA forma de terminar el proceso del
	// todo. Ninguna ventana (ni la de "Ver registro") lo hace: su botón X
	// solo la oculta, nunca mata el proceso (mismo patrón que Discord/Spotify).
	OnQuit func()
}

// New crea el icono (no lo muestra todavía; eso lo hace Start).
func New(tooltip string) *Tray { return &Tray{} }
